package handler

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/xcj/videosite-api/internal/cache"
	"github.com/xcj/videosite-api/internal/clickhouse"
	"github.com/xcj/videosite-api/internal/model"
	"github.com/xcj/videosite-api/internal/store"
)

type BannerHandler struct {
	admin       *store.AdminStore
	buffer      *clickhouse.EventBuffer
	chReader    *clickhouse.Reader
	cache       *cache.Cache
	siteBaseURL string
}

func NewBannerHandler(admin *store.AdminStore, buffer *clickhouse.EventBuffer, chReader *clickhouse.Reader, c *cache.Cache, siteBaseURL string) *BannerHandler {
	return &BannerHandler{admin: admin, buffer: buffer, chReader: chReader, cache: c, siteBaseURL: siteBaseURL}
}

// clientIP extracts the real client IP from X-Forwarded-For or RemoteAddr.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		return strings.TrimSpace(parts[0])
	}
	return r.RemoteAddr
}

// bannerExtra builds the JSON extra field for banner events.
func bannerExtra(bannerID int64, clickID string) string {
	if clickID != "" {
		return fmt.Sprintf(`{"banner_id":%d,"click_id":%q}`, bannerID, clickID)
	}
	return fmt.Sprintf(`{"banner_id":%d}`, bannerID)
}

// 1x1 transparent GIF for pixel tracking responses.
var transparentGIF = []byte{
	0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
	0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21,
	0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
	0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
	0x01, 0x00, 0x3b,
}

func writeTransparentPixel(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "image/gif")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Write(transparentGIF)
}

// ServeBanner handles GET /b/{id} — redirects to the banner image URL and logs an impression.
func (h *BannerHandler) ServeBanner(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	banner, err := h.admin.GetBannerByID(r.Context(), id)
	if err != nil {
		slog.Error("banner: serve", "error", err, "id", id)
		http.NotFound(w, r)
		return
	}
	if banner == nil || !banner.IsActive {
		http.NotFound(w, r)
		return
	}

	src := r.URL.Query().Get("src")
	clickID := r.URL.Query().Get("click_id")

	h.buffer.Push(model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_impression",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     bannerExtra(banner.ID, clickID),
		Source:    src,
		CreatedAt: time.Now().UTC(),
	})

	http.Redirect(w, r, banner.ImageURL, http.StatusFound)
}

// ClickBanner handles GET /b/{id}/click — redirects to the model profile and logs a click.
func (h *BannerHandler) ClickBanner(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	banner, err := h.admin.GetBannerByID(r.Context(), id)
	if err != nil {
		slog.Error("banner: click", "error", err, "id", id)
		http.NotFound(w, r)
		return
	}
	if banner == nil || !banner.IsActive {
		http.NotFound(w, r)
		return
	}

	src := r.URL.Query().Get("src")
	clickID := r.URL.Query().Get("click_id")

	h.buffer.Push(model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_click",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     bannerExtra(banner.ID, clickID),
		Source:    src,
		CreatedAt: time.Now().UTC(),
	})

	slug, err := h.admin.GetAccountSlug(r.Context(), banner.AccountID)
	if err != nil || slug == "" {
		slug = fmt.Sprintf("account/%d", banner.AccountID)
	}

	targetURL := fmt.Sprintf("/model/%s", slug)
	// Propagate source params to the landing page.
	if src != "" || clickID != "" {
		params := url.Values{}
		if src != "" {
			params.Set("src", src)
		}
		if clickID != "" {
			params.Set("click_id", clickID)
		}
		targetURL += "?" + params.Encode()
	}
	if h.siteBaseURL != "" {
		targetURL = h.siteBaseURL + targetURL
	}
	http.Redirect(w, r, targetURL, http.StatusFound)
}

// HoverBanner handles GET /b/{id}/hover — logs a banner hover event and returns a 1x1 pixel.
func (h *BannerHandler) HoverBanner(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeTransparentPixel(w)
		return
	}

	banner, err := h.admin.GetBannerByID(r.Context(), id)
	if err != nil || banner == nil || !banner.IsActive {
		writeTransparentPixel(w)
		return
	}

	src := r.URL.Query().Get("src")
	clickID := r.URL.Query().Get("click_id")

	h.buffer.Push(model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_hover",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     bannerExtra(banner.ID, clickID),
		Source:    src,
		CreatedAt: time.Now().UTC(),
	})

	writeTransparentPixel(w)
}

// ServeDynamic handles GET /b/serve — returns an HTML page with a random banner
// from the pool matching the requested size and optional targeting.
//
// Query params:
//   - size: "300x250" (or w + h separately)
//   - cat:  category slug
//   - kw:   keyword (matches video title/description)
//   - aid:  account ID
//   - src:  traffic source identifier
//   - click_id: ad network click ID for conversion tracking
//   - style: banner template style (bold/elegant/minimalist/card, default: random)
func (h *BannerHandler) ServeDynamic(w http.ResponseWriter, r *http.Request) {
	width, height := parseBannerSize(r)
	if width <= 0 || height <= 0 {
		http.Error(w, "missing or invalid size", http.StatusBadRequest)
		return
	}

	cat := r.URL.Query().Get("cat")
	kw := r.URL.Query().Get("kw")
	aid, _ := strconv.ParseInt(r.URL.Query().Get("aid"), 10, 64)
	src := r.URL.Query().Get("src")
	clickID := r.URL.Query().Get("click_id")
	style := r.URL.Query().Get("style")

	pool := h.getBannerPool(r, width, height, cat, kw, aid)

	// No-cache headers + allow iframe embedding.
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Del("X-Frame-Options")

	if len(pool) == 0 {
		// Graceful degradation: empty transparent page.
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `<!DOCTYPE html><html><head><style>body{margin:0}</style></head><body></body></html>`)
		return
	}

	banner := h.selectBestBanner(r.Context(), pool)

	// Determine source: use explicit src param, fallback to "serve".
	eventSource := src
	if eventSource == "" {
		eventSource = "serve"
	}

	// Log impression asynchronously.
	h.buffer.Push(model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_impression",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     bannerExtra(banner.ID, clickID),
		Source:    eventSource,
		CreatedAt: time.Now().UTC(),
	})

	// Build click URL with source params.
	clickURL := fmt.Sprintf("/b/%d/click", banner.ID)
	if src != "" || clickID != "" {
		params := url.Values{}
		if src != "" {
			params.Set("src", src)
		}
		if clickID != "" {
			params.Set("click_id", clickID)
		}
		clickURL += "?" + params.Encode()
	}
	if h.siteBaseURL != "" {
		clickURL = h.siteBaseURL + clickURL
	}

	// Build hover pixel URL.
	hoverURL := fmt.Sprintf("/b/%d/hover", banner.ID)
	if src != "" || clickID != "" {
		params := url.Values{}
		if src != "" {
			params.Set("src", src)
		}
		if clickID != "" {
			params.Set("click_id", clickID)
		}
		hoverURL += "?" + params.Encode()
	}
	if h.siteBaseURL != "" {
		hoverURL = h.siteBaseURL + hoverURL
	}

	// Use raw thumbnail for HTML template; fall back to static JPEG.
	thumbURL := banner.ThumbnailURL
	if thumbURL == "" {
		thumbURL = banner.ImageURL
	}

	tmpl := pickBannerStyle(style)
	data := bannerTemplateData{
		ThumbnailURL: thumbURL,
		Username:     banner.Username,
		ClickURL:     clickURL,
		HoverURL:     hoverURL,
		Width:        banner.Width,
		Height:       banner.Height,
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := tmpl.Execute(w, data); err != nil {
		slog.Error("banner: template render", "error", err, "style", style)
	}
}

// getBannerPool returns the pool of eligible banners, using Redis cache when possible.
func (h *BannerHandler) getBannerPool(r *http.Request, width, height int, cat, kw string, aid int64) []store.ServableBanner {
	ctx := r.Context()

	// Keyword = category slug, use it as cat filter.
	if kw != "" && cat == "" {
		cat = kw
	}

	// Determine cache key.
	var cacheKey string
	switch {
	case aid > 0:
		cacheKey = cache.BannerPoolAccKey(width, height, aid)
	case cat != "":
		cacheKey = cache.BannerPoolCatKey(width, height, cat)
	default:
		cacheKey = cache.BannerPoolKey(width, height)
	}

	// Try cache.
	var pool []store.ServableBanner
	if h.cache.GetJSON(ctx, cacheKey, &pool) {
		slog.Info("banner: cache hit", "key", cacheKey, "count", len(pool))
		return pool
	}

	// Cache miss — query DB.
	var err error
	pool, err = h.admin.ListServableBanners(ctx, width, height, cat, aid)
	if err != nil {
		slog.Error("banner: serve query", "error", err)
		return nil
	}

	slog.Info("banner: cache miss", "key", cacheKey, "count", len(pool))
	h.cache.SetList(ctx, cacheKey, pool)
	return pool
}

// selectBestBanner picks the banner with the highest CTR from the pool.
// If multiple banners share the max CTR (or all have zero), picks randomly among them.
func (h *BannerHandler) selectBestBanner(ctx context.Context, pool []store.ServableBanner) store.ServableBanner {
	if len(pool) == 1 {
		return pool[0]
	}

	videoIDs := make([]int64, len(pool))
	for i, b := range pool {
		videoIDs[i] = b.VideoID
	}

	stats, err := h.chReader.GetBannerStats(ctx, videoIDs)
	if err != nil || len(stats) == 0 {
		return pool[rand.Intn(len(pool))]
	}

	var maxCTR float64
	for _, b := range pool {
		if s, ok := stats[b.VideoID]; ok && s.CTR > maxCTR {
			maxCTR = s.CTR
		}
	}

	var best []store.ServableBanner
	for _, b := range pool {
		ctr := 0.0
		if s, ok := stats[b.VideoID]; ok {
			ctr = s.CTR
		}
		if ctr == maxCTR {
			best = append(best, b)
		}
	}

	return best[rand.Intn(len(best))]
}

// ServeLoader handles GET /b/loader.js — returns the embed script that
// extracts page context (title, meta, h1) and creates an iframe with keywords.
func (h *BannerHandler) ServeLoader(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Determine base URL for iframe src from the request's own origin.
	scheme := "https"
	if fproto := r.Header.Get("X-Forwarded-Proto"); fproto != "" {
		scheme = fproto
	}
	host := r.Host
	base := scheme + "://" + host

	fmt.Fprintf(w, loaderJS, base)
}

// loaderJS is the embed script template. %%s is replaced with the API base URL.
// All other literal %% are escaped for fmt.Fprintf.
const loaderJS = `(function(){
var s=document.currentScript;
var sz=s.getAttribute('data-size')||'300x250';
var src=s.getAttribute('data-src')||'';
var cid=s.getAttribute('data-click-id')||'';
var st=s.getAttribute('data-style')||'';
var gm=function(n){var e=document.querySelector('meta[name="'+n+'"],meta[property="'+n+'"]');return e?e.getAttribute('content')||'':''};
var raw=[document.title,gm('description'),gm('keywords'),gm('og:title'),gm('og:description')]
var h1=document.querySelector('h1');if(h1)raw.push(h1.textContent);
raw.push(location.pathname.replace(/[\/\-_]/g,' '));
raw=raw.join(' ').toLowerCase();
var stop={the:1,a:1,an:1,and:1,or:1,but:1,in:1,on:1,at:1,to:1,for:1,of:1,with:1,by:1,is:1,are:1,was:1,were:1,be:1,been:1,has:1,have:1,had:1,do:1,does:1,did:1,will:1,would:1,could:1,should:1,may:1,might:1,this:1,that:1,it:1,its:1,not:1,no:1,from:1,as:1,if:1,so:1,than:1,then:1,into:1,up:1,out:1,about:1,just:1,also:1,how:1,what:1,when:1,where:1,who:1,which:1,all:1,each:1,every:1,some:1,any:1,more:1,most:1,other:1,new:1,free:1,watch:1,video:1,videos:1,com:1,www:1,http:1,https:1,page:1,home:1,click:1,here:1,best:1,top:1,hot:1,sexy:1,model:1,models:1,content:1,profile:1,view:1,see:1,get:1,like:1,one:1,two:1};
var words=raw.match(/[a-z]{3,}/g)||[];
var freq={};
for(var i=0;i<words.length;i++){var w=words[i];if(!stop[w])freq[w]=(freq[w]||0)+1}
var sorted=Object.keys(freq).sort(function(a,b){return freq[b]-freq[a]});
var kw=sorted.slice(0,5).join(',');
var p=sz.split('x');
var base='%s';
var url=base+'/b/serve?size='+sz+(kw?'&kw='+encodeURIComponent(kw):'')+(src?'&src='+encodeURIComponent(src):'')+(cid?'&click_id='+encodeURIComponent(cid):'')+(st?'&style='+encodeURIComponent(st):'');
var div=document.createElement('div');
div.style.cssText='width:'+p[0]+'px;height:'+p[1]+'px;display:inline-block';
s.parentNode.insertBefore(div,s);
var mk=function(){var f=document.createElement('iframe');f.src=url;f.width=p[0];f.height=p[1];f.frameBorder='0';f.scrolling='no';f.style.cssText='border:none;overflow:hidden;display:block';div.appendChild(f)};
if('IntersectionObserver' in window){var o=new IntersectionObserver(function(e){if(e[0].isIntersecting){o.disconnect();mk()}},{rootMargin:'200px'});o.observe(div)}else{mk()}
})();
`

// parseBannerSize extracts width and height from "size=WxH" or "w=W&h=H" query params.
func parseBannerSize(r *http.Request) (int, int) {
	if sizeStr := r.URL.Query().Get("size"); sizeStr != "" {
		parts := strings.SplitN(sizeStr, "x", 2)
		if len(parts) == 2 {
			w, _ := strconv.Atoi(parts[0])
			h, _ := strconv.Atoi(parts[1])
			return w, h
		}
	}
	w, _ := strconv.Atoi(r.URL.Query().Get("w"))
	h, _ := strconv.Atoi(r.URL.Query().Get("h"))
	return w, h
}
