package cron

import (
	"context"
	"log/slog"

	"github.com/xcj/videosite-api/internal/clickhouse"
	"github.com/xcj/videosite-api/internal/ranking"
)

type FeedScoreRefresher struct {
	chReader *clickhouse.Reader
	ranker   *ranking.Service
}

func NewFeedScoreRefresher(chReader *clickhouse.Reader, ranker *ranking.Service) *FeedScoreRefresher {
	return &FeedScoreRefresher{chReader: chReader, ranker: ranker}
}

func (f *FeedScoreRefresher) Run(ctx context.Context) error {
	stats, err := f.chReader.GetFeedCTRStats(ctx)
	if err != nil {
		return err
	}

	for _, stat := range stats {
		score := ranking.BayesianCTR(stat.Clicks, stat.Impressions)
		f.ranker.SetScore(ctx, stat.VideoID, score, stat.Impressions)
	}

	slog.Info("cron: feed scores refreshed", "videos", len(stats))
	return nil
}
