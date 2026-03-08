package cron

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/xcj/videosite-api/internal/store"
)

type PostbackRetrier struct {
	admin *store.AdminStore
}

func NewPostbackRetrier(admin *store.AdminStore) *PostbackRetrier {
	return &PostbackRetrier{admin: admin}
}

func (p *PostbackRetrier) Run(ctx context.Context) error {
	postbacks, err := p.admin.ListPendingPostbacks(ctx, 100)
	if err != nil {
		return err
	}
	if len(postbacks) == 0 {
		return nil
	}

	client := &http.Client{Timeout: 10 * time.Second}
	retried := 0

	for _, pb := range postbacks {
		adSource, err := p.admin.GetAdSourceByName(ctx, pb.AdSourceName)
		if err != nil || adSource == nil || adSource.PostbackURL == "" {
			p.admin.UpdatePostbackStatus(ctx, pb.ID, "failed", 0, "ad source not found or inactive")
			continue
		}

		// Use stored CPA amount from the postback record (fallback to 0).
		cpaStr := "0"
		if pb.CpaAmount != nil && *pb.CpaAmount > 0 {
			cpaStr = strconv.FormatFloat(*pb.CpaAmount, 'f', -1, 64)
		}

		postbackURL := strings.ReplaceAll(adSource.PostbackURL, "{click_id}", url.QueryEscape(pb.ClickID))
		postbackURL = strings.ReplaceAll(postbackURL, "{event}", url.QueryEscape(pb.EventType))
		postbackURL = strings.ReplaceAll(postbackURL, "{cpa}", url.QueryEscape(cpaStr))

		resp, err := client.Get(postbackURL)
		if err != nil {
			p.admin.UpdatePostbackStatus(ctx, pb.ID, "failed", 0, err.Error())
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		resp.Body.Close()

		status := "sent"
		if resp.StatusCode >= 400 {
			status = "failed"
		}
		p.admin.UpdatePostbackStatus(ctx, pb.ID, status, resp.StatusCode, string(body))
		retried++
	}

	slog.Info("cron: postback retry", "total", len(postbacks), "retried", retried)
	return nil
}
