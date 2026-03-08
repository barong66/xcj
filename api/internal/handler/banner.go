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

// clientIP extracts the real client IP from X-Real-IP (set by nginx) or RemoteAddr.
func clientIP(r *http.Request) string {
	if realIP := r.Header.Get("X-Real-IP"); realIP != "" {
		return realIP
	}
	return r.RemoteAddr
}

// adNetworkParamKeys are the query param names for ad network macros we propagate.
var adNetworkParamKeys = []string{
	"ref_domain", "original_ref", "spot_id", "node_id",
	"auction_price", "cpv_price", "cpc", "campaign_id", "creative_id",
}

// readAdNetworkParams reads ad network macro params from the request query string.
func readAdNetworkParams(r *http.Request) map[string]string {
	q := r.URL.Query()
	params := make(map[string]string)
	for _, k := range adNetworkParamKeys {
		if v := q.Get(k); v != "" {
			params[k] = v
		}
	}
	return params
}

// bannerExtra builds the JSON extra field for banner events.
func bannerExtra(bannerID int64, clickID string, adParams map[string]string) string {
	parts := []string{fmt.Sprintf(`"banner_id":%d`, bannerID)}
	if clickID != "" {
		parts = append(parts, fmt.Sprintf(`"click_id":%q`, clickID))
	}
	for _, k := range adNetworkParamKeys {
		if v, ok := adParams[k]; ok {
			parts = append(parts, fmt.Sprintf(`%q:%q`, k, v))
		}
	}
	return "{" + strings.Join(parts, ",") + "}"
}

// appendAdNetworkParams adds ad network params to a url.Values.
func appendAdNetworkParams(params url.Values, adParams map[string]string) {
	for _, k := range adNetworkParamKeys {
		if v, ok := adParams[k]; ok {
			params.Set(k, v)
		}
	}
}

// enrichEvent fills parsed UA and client context fields on an event from the request.
func enrichEvent(e *model.Event, r *http.Request) {
	ua := ParseUA(r.UserAgent())
	e.Browser = ua.Browser
	e.OS = ua.OS
	e.DeviceType = ua.DeviceType
	e.Country = r.Header.Get("CF-IPCountry")

	q := r.URL.Query()
	e.ScreenWidth, _ = strconv.Atoi(q.Get("sw"))
	e.ScreenHeight, _ = strconv.Atoi(q.Get("sh"))
	e.ViewportWidth, _ = strconv.Atoi(q.Get("vw"))
	e.ViewportHeight, _ = strconv.Atoi(q.Get("vh"))
	e.Language = q.Get("lang")
	e.ConnectionType = q.Get("ct")
	e.PageURL = q.Get("pu")
	e.UTMSource = q.Get("utm_source")
	e.UTMMedium = q.Get("utm_medium")
	e.UTMCampaign = q.Get("utm_campaign")
}

func parseInt64(s string) int64 {
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}

func parseIntParam(s string) int {
	v, _ := strconv.Atoi(s)
	return v
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
	adParams := readAdNetworkParams(r)

	ev := model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_impression",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     bannerExtra(banner.ID, clickID, adParams),
		Source:    src,
		CreatedAt: time.Now().UTC(),
	}
	enrichEvent(&ev, r)
	h.buffer.Push(ev)

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
	adParams := readAdNetworkParams(r)

	ev := model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_click",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     bannerExtra(banner.ID, clickID, adParams),
		Source:    src,
		CreatedAt: time.Now().UTC(),
	}
	enrichEvent(&ev, r)
	h.buffer.Push(ev)

	slug, err := h.admin.GetAccountSlug(r.Context(), banner.AccountID)
	if err != nil || slug == "" {
		slug = fmt.Sprintf("account/%d", banner.AccountID)
	}

	targetURL := fmt.Sprintf("/model/%s", slug)
	// Propagate source + ad network params to the landing page.
	params := url.Values{}
	if src != "" {
		params.Set("src", src)
	}
	if clickID != "" {
		params.Set("click_id", clickID)
	}
	appendAdNetworkParams(params, adParams)
	if len(params) > 0 {
		targetURL += "?" + params.Encode()
	}
	// Scroll to the specific video thumbnail on the profile page.
	targetURL += fmt.Sprintf("#video-%d", banner.VideoID)
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
	adParams := readAdNetworkParams(r)

	ev := model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_hover",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     bannerExtra(banner.ID, clickID, adParams),
		Source:    src,
		CreatedAt: time.Now().UTC(),
	}
	enrichEvent(&ev, r)
	h.buffer.Push(ev)

	writeTransparentPixel(w)
}

// HandlePerfBeacon handles GET /b/perf — receives performance metrics beacon from banner JS.
func (h *BannerHandler) HandlePerfBeacon(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	bannerID, _ := strconv.ParseInt(q.Get("bid"), 10, 64)
	if bannerID == 0 {
		writeTransparentPixel(w)
		return
	}

	ua := ParseUA(r.UserAgent())

	p := model.PerfEvent{
		BannerID:        bannerID,
		VideoID:         parseInt64(q.Get("vid")),
		AccountID:       parseInt64(q.Get("aid")),
		ImageLoadMs:     parseIntParam(q.Get("ilt")),
		RenderMs:        parseIntParam(q.Get("rt")),
		TimeToVisibleMs: parseIntParam(q.Get("ttv")),
		DwellTimeMs:     parseIntParam(q.Get("dt")),
		HoverDurationMs: parseIntParam(q.Get("hd")),
		IsViewable:      q.Get("vb") == "1",
		Browser:         ua.Browser,
		OS:              ua.OS,
		DeviceType:      ua.DeviceType,
		ScreenWidth:     parseIntParam(q.Get("sw")),
		ScreenHeight:    parseIntParam(q.Get("sh")),
		ConnectionType:  q.Get("ct"),
		Country:         r.Header.Get("CF-IPCountry"),
	}

	go h.buffer.InsertPerfEvent(context.Background(), &p)
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
	adParams := readAdNetworkParams(r)

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
	ev := model.Event{
		SiteID:    0,
		VideoID:   banner.VideoID,
		AccountID: banner.AccountID,
		Type:      "banner_impression",
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
		Referrer:  r.Referer(),
		Extra:     bannerExtra(banner.ID, clickID, adParams),
		Source:    eventSource,
		CreatedAt: time.Now().UTC(),
	}
	enrichEvent(&ev, r)
	h.buffer.Push(ev)

	// Build click URL with source + ad network params.
	clickURL := fmt.Sprintf("/b/%d/click", banner.ID)
	clickParams := url.Values{}
	if src != "" {
		clickParams.Set("src", src)
	}
	if clickID != "" {
		clickParams.Set("click_id", clickID)
	}
	appendAdNetworkParams(clickParams, adParams)
	if len(clickParams) > 0 {
		clickURL += "?" + clickParams.Encode()
	}
	if h.siteBaseURL != "" {
		clickURL = h.siteBaseURL + clickURL
	}

	// Build hover pixel URL.
	hoverURL := fmt.Sprintf("/b/%d/hover", banner.ID)
	hoverParams := url.Values{}
	if src != "" {
		hoverParams.Set("src", src)
	}
	if clickID != "" {
		hoverParams.Set("click_id", clickID)
	}
	appendAdNetworkParams(hoverParams, adParams)
	if len(hoverParams) > 0 {
		hoverURL += "?" + hoverParams.Encode()
	}
	if h.siteBaseURL != "" {
		hoverURL = h.siteBaseURL + hoverURL
	}

	// Use raw thumbnail for HTML template; fall back to static JPEG.
	thumbURL := banner.ThumbnailURL
	if thumbURL == "" {
		thumbURL = banner.ImageURL
	}

	// Build perf beacon URL.
	perfURL := fmt.Sprintf("/b/perf?bid=%d&vid=%d&aid=%d", banner.ID, banner.VideoID, banner.AccountID)
	if h.siteBaseURL != "" {
		perfURL = h.siteBaseURL + perfURL
	}

	tmpl := pickBannerStyle(style)
	data := bannerTemplateData{
		ThumbnailURL: thumbURL,
		Username:     banner.Username,
		ClickURL:     clickURL,
		HoverURL:     hoverURL,
		Width:        banner.Width,
		Height:       banner.Height,
		BannerID:     banner.ID,
		VideoID:      banner.VideoID,
		AccountID:    banner.AccountID,
		PerfURL:      perfURL,
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

// PreviewBanner handles GET /b/{id}/preview?style=X — renders a specific banner
// in the chosen style template for admin preview (no impression logging).
func (h *BannerHandler) PreviewBanner(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	banner, err := h.admin.GetBannerByID(r.Context(), id)
	if err != nil || banner == nil {
		http.NotFound(w, r)
		return
	}

	style := r.URL.Query().Get("style")

	thumbURL := banner.ImageURL

	tmpl := pickBannerStyle(style)
	data := bannerTemplateData{
		ThumbnailURL: thumbURL,
		Username:     banner.Username,
		ClickURL:     "#",
		HoverURL:     "",
		Width:        banner.Width,
		Height:       banner.Height,
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Del("X-Frame-Options")
	if err := tmpl.Execute(w, data); err != nil {
		slog.Error("banner: preview template render", "error", err, "id", id, "style", style)
	}
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
var sw=screen.width;var sh=screen.height;
var vw=window.innerWidth;var vh=window.innerHeight;
var lang=(navigator.language||'').substring(0,5);
var ct='';try{var conn=navigator.connection||navigator.mozConnection||navigator.webkitConnection;if(conn)ct=conn.effectiveType||''}catch(e){}
var pu=encodeURIComponent(location.href);
var ups=new URLSearchParams(location.search);
var us=ups.get('utm_source')||'';var um=ups.get('utm_medium')||'';var uc=ups.get('utm_campaign')||'';
var ref=encodeURIComponent(document.referrer);
var adKeys=['ref_domain','original_ref','spot_id','node_id','auction_price','cpv_price','cpc','campaign_id','creative_id'];
var ad='';for(var i=0;i<adKeys.length;i++){var ak=adKeys[i];var av=s.getAttribute('data-'+ak.replace(/_/g,'-'))||'';if(av)ad+='&'+ak+'='+encodeURIComponent(av)}
var p=sz.split('x');
var base='%s';
var url=base+'/b/serve?size='+sz+(kw?'&kw='+encodeURIComponent(kw):'')+(src?'&src='+encodeURIComponent(src):'')+(cid?'&click_id='+encodeURIComponent(cid):'')+(st?'&style='+encodeURIComponent(st):'')+'&sw='+sw+'&sh='+sh+'&vw='+vw+'&vh='+vh+'&lang='+encodeURIComponent(lang)+'&ct='+encodeURIComponent(ct)+'&pu='+pu+'&ref='+ref+(us?'&utm_source='+encodeURIComponent(us):'')+(um?'&utm_medium='+encodeURIComponent(um):'')+(uc?'&utm_campaign='+encodeURIComponent(uc):'')+ad+'&t0='+Date.now();
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
