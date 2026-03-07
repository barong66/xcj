package handler

import (
	"html/template"
	"math/rand"
)

// bannerTemplateData holds all variables passed to banner HTML templates.
type bannerTemplateData struct {
	ThumbnailURL string
	Username     string
	ClickURL     string
	HoverURL     string
	Width        int
	Height       int
	BannerID     int64
	VideoID      int64
	AccountID    int64
	PerfURL      string
}

// bannerStyles lists all available template style names.
var bannerStyles = []string{"bold", "elegant", "minimalist", "card"}

// bannerTemplates maps style name to compiled template.
var bannerTemplates map[string]*template.Template

func init() {
	bannerTemplates = map[string]*template.Template{
		"bold":       template.Must(template.New("bold").Parse(tmplBold)),
		"elegant":    template.Must(template.New("elegant").Parse(tmplElegant)),
		"minimalist": template.Must(template.New("minimalist").Parse(tmplMinimalist)),
		"card":       template.Must(template.New("card").Parse(tmplCard)),
	}
}

// pickBannerStyle returns the template for the given style, or a random one.
func pickBannerStyle(style string) *template.Template {
	if t, ok := bannerTemplates[style]; ok {
		return t
	}
	return bannerTemplates[bannerStyles[rand.Intn(len(bannerStyles))]]
}

// ─── Bold ────────────────────────────────────────────────────────────────────

const tmplBold = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{overflow:hidden;background:#000}
.b{width:{{.Width}}px;height:{{.Height}}px;position:relative;overflow:hidden;
  font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;cursor:pointer;
  border:3px solid #FF2D7B;box-shadow:0 0 20px rgba(255,45,123,.4)}
.b img{width:100%;height:100%;object-fit:cover;object-position:center 20%;display:block;
  transition:transform .3s ease;filter:contrast(1.15) saturate(1.2) brightness(1.05)}
.b:hover img{transform:scale(1.05);filter:contrast(1.2) saturate(1.3) brightness(1.1)}
.b::after{content:'';position:absolute;bottom:0;left:0;right:0;height:45%;
  background:linear-gradient(to top,rgba(0,0,0,.75) 0%,rgba(0,0,0,.2) 60%,transparent 100%);z-index:1}
.ca{position:absolute;top:-30px;right:-30px;width:60px;height:60px;
  background:linear-gradient(135deg,transparent 50%,rgba(255,45,123,.3) 50%);z-index:2}
.ct{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;
  justify-content:space-between;padding:clamp(8px,4%,14px)}
.un{color:#fff;font-size:clamp(11px,5%,15px);font-weight:800;text-transform:uppercase;
  letter-spacing:1px;text-shadow:0 0 15px rgba(255,45,123,.6),0 2px 4px rgba(0,0,0,.5)}
.bt{display:flex;flex-direction:column;align-items:center;gap:clamp(4px,2%,8px)}
.tg{color:rgba(255,255,255,.7);font-size:clamp(8px,3.5%,10px);font-weight:700;
  text-transform:uppercase;letter-spacing:2px}
.cta{display:inline-block;padding:clamp(6px,3%,10px) clamp(16px,8%,32px);
  background:linear-gradient(135deg,#FF2D7B 0%,#FF6B35 100%);color:#fff;
  font-size:clamp(10px,4%,13px);font-weight:900;text-transform:uppercase;
  letter-spacing:1.5px;border-radius:25px;text-decoration:none;
  box-shadow:0 0 25px rgba(255,45,123,.5),0 4px 15px rgba(0,0,0,.3);
  transition:box-shadow .2s,transform .2s}
.b:hover .cta{box-shadow:0 0 35px rgba(255,45,123,.7),0 4px 20px rgba(0,0,0,.4);transform:scale(1.05)}
</style></head>
<body>
<a href="{{.ClickURL}}" target="_top" style="text-decoration:none">
<div class="b" id="bn">
  <img src="{{.ThumbnailURL}}" alt="">
  <div class="ca"></div>
  <div class="ct">
    <span class="un">@{{.Username}}</span>
    <div class="bt">
      <span class="tg">Exclusive Content</span>
      <span class="cta">Watch Me Now</span>
    </div>
  </div>
</div>
</a>
<script>
(function(){
var d=false,bn=document.getElementById('bn');
bn.addEventListener('mouseenter',function(){if(d)return;d=true;new Image().src='{{.HoverURL}}';});
var ps=new URLSearchParams(location.search);
var sw=ps.get('sw')||0,sh=ps.get('sh')||0,ct=ps.get('ct')||'';
var rs=Date.now(),ilt=0,vb=0,tv=0,vs=0;
var img=document.querySelector('img');
if(img&&!img.complete){var is=Date.now();img.onload=function(){ilt=Date.now()-is}}
var vt=null;
function onV(){if(!vs){vs=Date.now()}vt=setTimeout(function(){vb=1},1000)}
function offV(){if(vs){tv+=Date.now()-vs;vs=0}if(vt)clearTimeout(vt)}
document.addEventListener('visibilitychange',function(){document.hidden?offV():onV()});
if(!document.hidden)onV();
var hs=0,th=0;
bn.addEventListener('mouseenter',function(){hs=Date.now()});
bn.addEventListener('mouseleave',function(){if(hs){th+=Date.now()-hs;hs=0}});
var sent=false;
function sp(){if(sent)return;sent=true;if(vs)tv+=Date.now()-vs;
var u='{{.PerfURL}}'+'&ilt='+ilt+'&rt='+(Date.now()-rs)+'&ttv='+(rs-(parseInt(ps.get('t0'))||rs))+'&dt='+tv+'&hd='+th+'&vb='+vb+'&sw='+sw+'&sh='+sh+'&ct='+ct;
if(navigator.sendBeacon){navigator.sendBeacon(u)}else{new Image().src=u}}
window.addEventListener('pagehide',sp);
setTimeout(sp,10000);
})();
</script>
</body></html>`

// ─── Elegant ─────────────────────────────────────────────────────────────────

const tmplElegant = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{overflow:hidden;background:#000}
.b{width:{{.Width}}px;height:{{.Height}}px;position:relative;overflow:hidden;
  background:#000;cursor:pointer}
.b img{width:100%;height:100%;object-fit:cover;object-position:center 15%;display:block;
  transition:transform .4s ease,filter .3s ease;filter:contrast(1.15) saturate(1.2) brightness(1.05)}
.b:hover img{transform:scale(1.04);filter:contrast(1.2) saturate(1.3) brightness(1.1)}
.b::before{content:'';position:absolute;inset:0;
  background:linear-gradient(to top,rgba(0,0,0,.7) 0%,rgba(0,0,0,.3) 25%,transparent 55%);z-index:1}
.ct{position:absolute;bottom:0;left:0;right:0;z-index:3;display:flex;flex-direction:column;
  align-items:center;padding-bottom:clamp(10px,6%,20px)}
.gl{width:60px;height:1px;background:linear-gradient(90deg,transparent,#C9A96E,transparent);
  margin-bottom:clamp(8px,4%,14px)}
.or{width:6px;height:6px;background:#C9A96E;transform:rotate(45deg);
  margin-bottom:clamp(6px,3%,12px);opacity:.7}
.un{font-family:Georgia,'Times New Roman',serif;color:#fff;
  font-size:clamp(12px,5.5%,17px);font-weight:400;letter-spacing:4px;
  text-transform:uppercase;text-shadow:0 1px 6px rgba(0,0,0,.6);
  margin-bottom:clamp(4px,2%,8px)}
.cta{font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#C9A96E;
  font-size:clamp(7px,3%,9px);font-weight:400;letter-spacing:3px;
  text-transform:uppercase;opacity:.8;transition:opacity .2s}
.b:hover .cta{opacity:1}
.ta{position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent 10%,rgba(201,169,110,.4) 50%,transparent 90%);z-index:2}
</style></head>
<body>
<a href="{{.ClickURL}}" target="_top" style="text-decoration:none">
<div class="b" id="bn">
  <img src="{{.ThumbnailURL}}" alt="">
  <div class="ta"></div>
  <div class="ct">
    <div class="or"></div>
    <div class="gl"></div>
    <span class="un">{{.Username}}</span>
    <span class="cta">View Profile</span>
  </div>
</div>
</a>
<script>
(function(){
var d=false,bn=document.getElementById('bn');
bn.addEventListener('mouseenter',function(){if(d)return;d=true;new Image().src='{{.HoverURL}}';});
var ps=new URLSearchParams(location.search);
var sw=ps.get('sw')||0,sh=ps.get('sh')||0,ct=ps.get('ct')||'';
var rs=Date.now(),ilt=0,vb=0,tv=0,vs=0;
var img=document.querySelector('img');
if(img&&!img.complete){var is=Date.now();img.onload=function(){ilt=Date.now()-is}}
var vt=null;
function onV(){if(!vs){vs=Date.now()}vt=setTimeout(function(){vb=1},1000)}
function offV(){if(vs){tv+=Date.now()-vs;vs=0}if(vt)clearTimeout(vt)}
document.addEventListener('visibilitychange',function(){document.hidden?offV():onV()});
if(!document.hidden)onV();
var hs=0,th=0;
bn.addEventListener('mouseenter',function(){hs=Date.now()});
bn.addEventListener('mouseleave',function(){if(hs){th+=Date.now()-hs;hs=0}});
var sent=false;
function sp(){if(sent)return;sent=true;if(vs)tv+=Date.now()-vs;
var u='{{.PerfURL}}'+'&ilt='+ilt+'&rt='+(Date.now()-rs)+'&ttv='+(rs-(parseInt(ps.get('t0'))||rs))+'&dt='+tv+'&hd='+th+'&vb='+vb+'&sw='+sw+'&sh='+sh+'&ct='+ct;
if(navigator.sendBeacon){navigator.sendBeacon(u)}else{new Image().src=u}}
window.addEventListener('pagehide',sp);
setTimeout(sp,10000);
})();
</script>
</body></html>`

// ─── Minimalist ──────────────────────────────────────────────────────────────

const tmplMinimalist = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{overflow:hidden;background:#000}
.b{width:{{.Width}}px;height:{{.Height}}px;position:relative;overflow:hidden;
  background:#000;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;cursor:pointer}
.b img{width:100%;height:100%;object-fit:cover;object-position:center 20%;display:block;
  transition:transform .3s ease,filter .3s ease;filter:contrast(1.15) saturate(1.2) brightness(1.05)}
.b:hover img{transform:scale(1.03);filter:contrast(1.2) saturate(1.3) brightness(1.1)}
.b::after{content:'';position:absolute;bottom:0;left:0;right:0;height:35%;
  background:linear-gradient(to top,rgba(0,0,0,.6) 0%,rgba(0,0,0,.15) 60%,transparent 100%);
  pointer-events:none}
.ov{position:absolute;bottom:0;left:0;right:0;padding:clamp(8px,4%,14px) clamp(10px,5%,16px);
  z-index:2;display:flex;justify-content:space-between;align-items:flex-end}
.un{color:#fff;font-size:clamp(10px,4.5%,14px);font-weight:500;
  text-shadow:0 1px 4px rgba(0,0,0,.6);letter-spacing:.3px}
.cta{color:rgba(255,255,255,.6);font-size:clamp(8px,3.5%,11px);font-weight:400;
  text-shadow:0 1px 3px rgba(0,0,0,.5);letter-spacing:.5px;transition:color .2s}
.b:hover .cta{color:rgba(255,255,255,.9)}
.wm{position:absolute;top:clamp(6px,3%,10px);left:clamp(8px,4%,12px);z-index:2;
  color:rgba(255,255,255,.35);font-size:clamp(6px,2.5%,8px);font-weight:400;
  letter-spacing:1px;text-transform:uppercase;text-shadow:0 1px 2px rgba(0,0,0,.4)}
</style></head>
<body>
<a href="{{.ClickURL}}" target="_top" style="text-decoration:none">
<div class="b" id="bn">
  <img src="{{.ThumbnailURL}}" alt="">
  <span class="wm">TemptGuide</span>
  <div class="ov">
    <span class="un">@{{.Username}}</span>
    <span class="cta">View Profile &#8594;</span>
  </div>
</div>
</a>
<script>
(function(){
var d=false,bn=document.getElementById('bn');
bn.addEventListener('mouseenter',function(){if(d)return;d=true;new Image().src='{{.HoverURL}}';});
var ps=new URLSearchParams(location.search);
var sw=ps.get('sw')||0,sh=ps.get('sh')||0,ct=ps.get('ct')||'';
var rs=Date.now(),ilt=0,vb=0,tv=0,vs=0;
var img=document.querySelector('img');
if(img&&!img.complete){var is=Date.now();img.onload=function(){ilt=Date.now()-is}}
var vt=null;
function onV(){if(!vs){vs=Date.now()}vt=setTimeout(function(){vb=1},1000)}
function offV(){if(vs){tv+=Date.now()-vs;vs=0}if(vt)clearTimeout(vt)}
document.addEventListener('visibilitychange',function(){document.hidden?offV():onV()});
if(!document.hidden)onV();
var hs=0,th=0;
bn.addEventListener('mouseenter',function(){hs=Date.now()});
bn.addEventListener('mouseleave',function(){if(hs){th+=Date.now()-hs;hs=0}});
var sent=false;
function sp(){if(sent)return;sent=true;if(vs)tv+=Date.now()-vs;
var u='{{.PerfURL}}'+'&ilt='+ilt+'&rt='+(Date.now()-rs)+'&ttv='+(rs-(parseInt(ps.get('t0'))||rs))+'&dt='+tv+'&hd='+th+'&vb='+vb+'&sw='+sw+'&sh='+sh+'&ct='+ct;
if(navigator.sendBeacon){navigator.sendBeacon(u)}else{new Image().src=u}}
window.addEventListener('pagehide',sp);
setTimeout(sp,10000);
})();
</script>
</body></html>`

// ─── Card ────────────────────────────────────────────────────────────────────

const tmplCard = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{overflow:hidden;background:#000}
.b{width:{{.Width}}px;height:{{.Height}}px;position:relative;overflow:hidden;
  background:#0D0D0D;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
  cursor:pointer;border-radius:6px;border:1px solid rgba(255,255,255,.08);
  box-shadow:0 4px 20px rgba(0,0,0,.4)}
.ph{position:relative;width:100%;height:75%;overflow:hidden}
.ph img{width:100%;height:100%;object-fit:cover;object-position:center 20%;display:block;
  transition:transform .3s ease,filter .3s ease;filter:contrast(1.15) saturate(1.2) brightness(1.05)}
.b:hover .ph img{transform:scale(1.04);filter:contrast(1.2) saturate(1.3) brightness(1.1)}
.ph::after{content:'';position:absolute;bottom:0;left:0;right:0;height:30px;
  background:linear-gradient(to top,#1A1A2E 0%,transparent 100%)}
.bar{position:relative;height:25%;background:#1A1A2E;display:flex;
  align-items:center;justify-content:space-between;
  padding:0 clamp(8px,5%,16px)}
.bar::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,#E94560 0%,#E94560 40%,rgba(233,69,96,.3) 100%)}
.bl{display:flex;flex-direction:column;gap:3px}
.un{color:#fff;font-size:clamp(10px,4%,13px);font-weight:600;letter-spacing:.3px}
.st{color:rgba(255,255,255,.4);font-size:clamp(8px,3%,10px);font-weight:400}
.pb{width:clamp(28px,10%,36px);height:clamp(28px,10%,36px);border-radius:50%;
  background:#E94560;display:flex;align-items:center;justify-content:center;
  box-shadow:0 0 15px rgba(233,69,96,.3);transition:transform .2s,box-shadow .2s;
  flex-shrink:0}
.b:hover .pb{transform:scale(1.08);box-shadow:0 0 25px rgba(233,69,96,.5)}
.pi{width:0;height:0;border-style:solid;border-width:6px 0 6px 10px;
  border-color:transparent transparent transparent #fff;margin-left:2px}
.ld{position:absolute;top:clamp(8px,4%,12px);right:clamp(8px,4%,12px);
  width:8px;height:8px;background:#E94560;border-radius:50%;
  box-shadow:0 0 6px rgba(233,69,96,.6);z-index:2}
</style></head>
<body>
<a href="{{.ClickURL}}" target="_top" style="text-decoration:none">
<div class="b" id="bn">
  <div class="ph">
    <img src="{{.ThumbnailURL}}" alt="">
    <div class="ld"></div>
  </div>
  <div class="bar">
    <div class="bl">
      <span class="un">@{{.Username}}</span>
      <span class="st">Watch exclusive content</span>
    </div>
    <div class="pb"><div class="pi"></div></div>
  </div>
</div>
</a>
<script>
(function(){
var d=false,bn=document.getElementById('bn');
bn.addEventListener('mouseenter',function(){if(d)return;d=true;new Image().src='{{.HoverURL}}';});
var ps=new URLSearchParams(location.search);
var sw=ps.get('sw')||0,sh=ps.get('sh')||0,ct=ps.get('ct')||'';
var rs=Date.now(),ilt=0,vb=0,tv=0,vs=0;
var img=document.querySelector('img');
if(img&&!img.complete){var is=Date.now();img.onload=function(){ilt=Date.now()-is}}
var vt=null;
function onV(){if(!vs){vs=Date.now()}vt=setTimeout(function(){vb=1},1000)}
function offV(){if(vs){tv+=Date.now()-vs;vs=0}if(vt)clearTimeout(vt)}
document.addEventListener('visibilitychange',function(){document.hidden?offV():onV()});
if(!document.hidden)onV();
var hs=0,th=0;
bn.addEventListener('mouseenter',function(){hs=Date.now()});
bn.addEventListener('mouseleave',function(){if(hs){th+=Date.now()-hs;hs=0}});
var sent=false;
function sp(){if(sent)return;sent=true;if(vs)tv+=Date.now()-vs;
var u='{{.PerfURL}}'+'&ilt='+ilt+'&rt='+(Date.now()-rs)+'&ttv='+(rs-(parseInt(ps.get('t0'))||rs))+'&dt='+tv+'&hd='+th+'&vb='+vb+'&sw='+sw+'&sh='+sh+'&ct='+ct;
if(navigator.sendBeacon){navigator.sendBeacon(u)}else{new Image().src=u}}
window.addEventListener('pagehide',sp);
setTimeout(sp,10000);
})();
</script>
</body></html>`
