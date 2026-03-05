package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// Cache wraps a Redis client with typed get/set operations and TTL management.
type Cache struct {
	client     *redis.Client
	listTTL    time.Duration
	detailTTL  time.Duration
}

// New creates a new Cache connected to the given Redis URL.
// redisURL should be in the format redis://host:port/db.
func New(redisURL string, listTTL, detailTTL time.Duration) (*Cache, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("cache: parse redis url: %w", err)
	}

	client := redis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("cache: ping redis: %w", err)
	}

	return &Cache{
		client:    client,
		listTTL:   listTTL,
		detailTTL: detailTTL,
	}, nil
}

// Ping checks the Redis connection.
func (c *Cache) Ping(ctx context.Context) error {
	return c.client.Ping(ctx).Err()
}

// Close shuts down the Redis connection.
func (c *Cache) Close() error {
	return c.client.Close()
}

// GetJSON retrieves a cached JSON value and unmarshals it into dest.
// Returns false if the key does not exist or on any error.
func (c *Cache) GetJSON(ctx context.Context, key string, dest interface{}) bool {
	data, err := c.client.Get(ctx, key).Bytes()
	if err != nil {
		if err != redis.Nil {
			slog.Error("cache: get", "key", key, "error", err)
		}
		return false
	}

	if err := json.Unmarshal(data, dest); err != nil {
		slog.Error("cache: unmarshal", "key", key, "error", err)
		return false
	}

	return true
}

// SetJSON marshals val to JSON and stores it with the given TTL.
func (c *Cache) SetJSON(ctx context.Context, key string, val interface{}, ttl time.Duration) {
	data, err := json.Marshal(val)
	if err != nil {
		slog.Error("cache: marshal", "key", key, "error", err)
		return
	}

	if err := c.client.Set(ctx, key, data, ttl).Err(); err != nil {
		slog.Error("cache: set", "key", key, "error", err)
	}
}

// SetList stores a list result with the list TTL.
func (c *Cache) SetList(ctx context.Context, key string, val interface{}) {
	c.SetJSON(ctx, key, val, c.listTTL)
}

// SetDetail stores a detail result with the detail TTL.
func (c *Cache) SetDetail(ctx context.Context, key string, val interface{}) {
	c.SetJSON(ctx, key, val, c.detailTTL)
}

// Delete removes one or more keys from the cache.
func (c *Cache) Delete(ctx context.Context, keys ...string) {
	if len(keys) == 0 {
		return
	}
	if err := c.client.Del(ctx, keys...).Err(); err != nil {
		slog.Error("cache: delete", "keys", keys, "error", err)
	}
}

// InvalidatePattern removes all keys matching a glob pattern.
func (c *Cache) InvalidatePattern(ctx context.Context, pattern string) {
	iter := c.client.Scan(ctx, 0, pattern, 100).Iterator()
	var keys []string
	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
	}
	if err := iter.Err(); err != nil {
		slog.Error("cache: scan for invalidation", "pattern", pattern, "error", err)
		return
	}
	if len(keys) > 0 {
		c.Delete(ctx, keys...)
	}
}

// Key helpers for consistent cache key naming.

func VideoListKey(siteID int64, sort string, categoryID int64, countryID int64, page int) string {
	return fmt.Sprintf("vl:%d:%s:%d:%d:%d", siteID, sort, categoryID, countryID, page)
}

func VideoDetailKey(videoID int64) string {
	return fmt.Sprintf("vd:%d", videoID)
}

func CategoriesKey(siteID int64) string {
	return fmt.Sprintf("cat:%d", siteID)
}

func CategoryDetailKey(siteID int64, slug string) string {
	return fmt.Sprintf("catd:%d:%s", siteID, slug)
}

func AccountKey(accountID int64, perPage int) string {
	return fmt.Sprintf("acc:%d:%d", accountID, perPage)
}

func AccountSlugKey(slug string, perPage int) string {
	return fmt.Sprintf("accs:%s:%d", slug, perPage)
}

func SearchKey(siteID int64, query string, page int) string {
	return fmt.Sprintf("src:%d:%s:%d", siteID, query, page)
}

// Client returns the underlying Redis client (used by ranking service).
func (c *Cache) Client() *redis.Client {
	return c.client
}

func AnchorFeedKey(siteID int64, slug string, page int) string {
	return fmt.Sprintf("af:%d:%s:%d", siteID, slug, page)
}

func RankedFeedKey(siteID int64, page int) string {
	return fmt.Sprintf("rf:%d:%d", siteID, page)
}

func BannerPoolKey(width, height int) string {
	return fmt.Sprintf("bp:%dx%d", width, height)
}

func BannerPoolCatKey(width, height int, catSlug string) string {
	return fmt.Sprintf("bp:%dx%d:%s", width, height, catSlug)
}

func BannerPoolAccKey(width, height int, accountID int64) string {
	return fmt.Sprintf("bp:%dx%d:a%d", width, height, accountID)
}

// InvalidateAccounts removes all cached account data.
func (c *Cache) InvalidateAccounts(ctx context.Context) {
	c.InvalidatePattern(ctx, "acc:*")
	c.InvalidatePattern(ctx, "accs:*")
}

// InvalidateSite removes all cached data for a given site.
func (c *Cache) InvalidateSite(ctx context.Context, siteID int64) {
	sid := fmt.Sprintf("%d", siteID)
	c.InvalidatePattern(ctx, "vl:"+sid+":*")
	c.InvalidatePattern(ctx, "cat:"+sid)
	c.InvalidatePattern(ctx, "catd:"+sid+":*")
	c.InvalidatePattern(ctx, "src:"+sid+":*")
	c.InvalidatePattern(ctx, "af:"+sid+":*")
	c.InvalidatePattern(ctx, "rf:"+sid+":*")
}
