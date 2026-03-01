package ranking

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand"
	"sort"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	ScoreKeyPrefix      = "feed_score:"
	ImpKeyPrefix        = "feed_imp:"
	ScoreTTL            = 2 * time.Hour
	ImpressionThreshold = 30
	PriorClicks         = 2.0
	PriorImpressions    = 100.0
	PoolACycleSize      = 3
	PoolBCycleSize      = 1
)

type Service struct {
	rdb *redis.Client
}

func NewService(rdb *redis.Client) *Service {
	return &Service{rdb: rdb}
}

// BayesianCTR calculates the Bayesian smoothed CTR.
// Formula: (clicks + prior_clicks) / (impressions + prior_impressions)
func BayesianCTR(clicks, impressions int64) float64 {
	return (float64(clicks) + PriorClicks) / (float64(impressions) + PriorImpressions)
}

// SetScore stores the CTR score and impression count for a video in Redis.
func (s *Service) SetScore(ctx context.Context, videoID int64, score float64, impressions int64) {
	pipe := s.rdb.Pipeline()
	vid := strconv.FormatInt(videoID, 10)
	pipe.Set(ctx, ScoreKeyPrefix+vid, fmt.Sprintf("%.8f", score), ScoreTTL)
	pipe.Set(ctx, ImpKeyPrefix+vid, strconv.FormatInt(impressions, 10), ScoreTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		slog.Error("ranking: set score", "video_id", videoID, "error", err)
	}
}

type videoScore struct {
	ID    int64
	Score float64
	Imp   int64
}

// ClassifyAndSort splits video IDs into Pool A (≥threshold impressions, sorted by CTR desc)
// and Pool B (<threshold impressions, shuffled randomly).
func (s *Service) ClassifyAndSort(ctx context.Context, videoIDs []int64) (poolA, poolB []int64) {
	if len(videoIDs) == 0 {
		return nil, nil
	}

	// Build keys for pipeline
	scoreKeys := make([]string, len(videoIDs))
	impKeys := make([]string, len(videoIDs))
	for i, id := range videoIDs {
		vid := strconv.FormatInt(id, 10)
		scoreKeys[i] = ScoreKeyPrefix + vid
		impKeys[i] = ImpKeyPrefix + vid
	}

	// Batch read via pipeline
	pipe := s.rdb.Pipeline()
	scoreCmds := make([]*redis.StringCmd, len(videoIDs))
	impCmds := make([]*redis.StringCmd, len(videoIDs))
	for i := range videoIDs {
		scoreCmds[i] = pipe.Get(ctx, scoreKeys[i])
		impCmds[i] = pipe.Get(ctx, impKeys[i])
	}
	_, _ = pipe.Exec(ctx) // errors are per-key (redis.Nil)

	var aScored []videoScore

	for i, id := range videoIDs {
		scoreStr, scoreErr := scoreCmds[i].Result()
		impStr, impErr := impCmds[i].Result()

		if scoreErr != nil || impErr != nil {
			// No score data → Pool B (exploration)
			poolB = append(poolB, id)
			continue
		}

		sc, _ := strconv.ParseFloat(scoreStr, 64)
		imp, _ := strconv.ParseInt(impStr, 10, 64)

		if imp >= ImpressionThreshold {
			aScored = append(aScored, videoScore{ID: id, Score: sc, Imp: imp})
		} else {
			poolB = append(poolB, id)
		}
	}

	// Sort Pool A by score descending
	sort.Slice(aScored, func(i, j int) bool {
		return aScored[i].Score > aScored[j].Score
	})
	poolA = make([]int64, len(aScored))
	for i, vs := range aScored {
		poolA[i] = vs.ID
	}

	// Shuffle Pool B
	rand.Shuffle(len(poolB), func(i, j int) {
		poolB[i], poolB[j] = poolB[j], poolB[i]
	})

	return poolA, poolB
}

// MixFeed interleaves Pool A and Pool B: 3 from A, 1 from B, repeating.
// If one pool is exhausted, the remainder comes from the other.
func MixFeed(poolA, poolB []int64, count int) []int64 {
	result := make([]int64, 0, count)
	aIdx, bIdx := 0, 0

	for len(result) < count {
		// Take up to PoolACycleSize from A
		for i := 0; i < PoolACycleSize && len(result) < count; i++ {
			if aIdx < len(poolA) {
				result = append(result, poolA[aIdx])
				aIdx++
			} else if bIdx < len(poolB) {
				result = append(result, poolB[bIdx])
				bIdx++
			} else {
				return result
			}
		}

		// Take up to PoolBCycleSize from B
		for i := 0; i < PoolBCycleSize && len(result) < count; i++ {
			if bIdx < len(poolB) {
				result = append(result, poolB[bIdx])
				bIdx++
			} else if aIdx < len(poolA) {
				result = append(result, poolA[aIdx])
				aIdx++
			} else {
				return result
			}
		}
	}

	return result
}
