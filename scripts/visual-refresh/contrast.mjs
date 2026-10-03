import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { startSandbox } from "./sandbox.mjs";
import { waitForPage } from "./readiness.mjs";

const sandbox = await startSandbox({ build: false, port: 4350 });
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true });
const rows = [], rendered = [], targets = [];
const pairings = [
  ...["background","card","popover","muted","secondary","accent"].flatMap(bg => [["foreground",bg,4.5],["muted-foreground",bg,4.5]]),
  ["primary-foreground","primary",4.5],["secondary-foreground","secondary",4.5],["accent-foreground","accent",4.5],
  ["destructive-foreground","destructive",4.5],["solid-foreground","solid",4.5],
  ["primary","solid",4.5],
  ["signature-ink","signature-paper",4.5],
  ["card-foreground","card",4.5],["foreground","surface",4.5],["foreground","surface-header",4.5],
  ["muted-foreground","surface",4.5],["muted-foreground","surface-header",4.5],
  ["sidebar-accent-foreground","sidebar-accent",4.5],["sidebar-primary-foreground","sidebar-primary",4.5],
  ...["success","warning","danger","info"].flatMap(fg => [[fg,`${fg}-bg`,4.5],[fg,"card",4.5],[fg,"background",4.5]]),
  ["sidebar-foreground","sidebar",4.5],["sidebar-accent-foreground","sidebar-accent",4.5],
  ...["background","card","muted","secondary","accent","popover"].map(bg => ["ring",bg,3]),
  ["sidebar-ring","sidebar",3],["sidebar-primary","sidebar",3],
  ...["chart-1","chart-2","chart-3","chart-4","chart-5"].map(fg => [fg,"card",3]),
  ["input","card",3],["primary-border","card",3],["ring","card",3],["input","background",3],
];
try {
  for (const mode of ["light","dark"]) {
    const context = await browser.newContext({ colorScheme: mode, reducedMotion: "reduce" });
    const page = await context.newPage();
    await sandbox.login(page);
    await page.goto(sandbox.url + "/settings", { waitUntil:"networkidle" });
    await waitForPage(page,"settings");
    const results = await page.evaluate(({pairings,mode}) => {
      function rgba(css) {
        // Ask the browser to convert modern hsl/color() into sRGB, not a
        // handwritten approximation of the authored token.
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = css; ctx.fillRect(0,0,1,1);
        const [r,g,b,a] = ctx.getImageData(0,0,1,1).data;
        return [r,g,b,a/255];
      }
      function composite(fg,bg) { return [0,1,2].map(i => fg[i]*(fg[3]??1)+bg[i]*(1-(fg[3]??1))).concat(1); }
      function luminance(color) { return color.slice(0,3).map(c => c/255).map(c => c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0); }
      function ratio(a,b) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
      const probe = document.createElement("span");document.body.append(probe);
      function token(name,alpha) {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
        probe.style.color = raw.startsWith("#") ? `var(--${name})` : `hsl(var(--${name})${alpha===undefined?"":` / ${alpha}`})`;
        return rgba(getComputedStyle(probe).color);
      }
      const out = [];
      function add(fgName,bgName,threshold,fg,bg,note="") {
        const measured = ratio(composite(fg,bg),bg);
        out.push({ mode, foreground:fgName, background:bgName, foregroundRGB:composite(fg,bg).slice(0,3), backgroundRGB:bg.slice(0,3), ratio:measured,threshold,passed:measured>=threshold,note });
      }
      for (const [fg,bg,threshold] of pairings) add(fg,bg,threshold,token(fg),token(bg));
      for (const [fg,bg] of [["primary-foreground","primary"],["destructive-foreground","destructive"]]) {
        for (const under of ["background","card","muted"]) add(fg,`${bg}/90 over ${under}`,4.5,token(fg),composite(token(bg,.9),token(under)),"Hover state");
      }
      add("sidebar-foreground/70","sidebar",4.5,token("sidebar-foreground",.7),token("sidebar"),"Muted navigation/section labels");
      add("solid-foreground/70","solid",4.5,token("solid-foreground",.7),token("solid"),"Muted fixed hero text");
      for (const under of ["background","card","primary","solid","sidebar","black","white"]) {
        const base=under === "black" ? [0,0,0,1] : under === "white" ? [255,255,255,1] : token(under);
        probe.style.color="hsl(var(--glass-bg))";const glass=rgba(getComputedStyle(probe).color);
        const bg=composite(glass,base);
        for (const fg of ["popover-foreground","muted-foreground","success","warning","danger","info"]) add(fg,`glass over ${under}`,4.5,token(fg),bg,"Worst-case allowed floating backdrop");
        add("ring",`glass over ${under}`,3,token("ring"),bg,"Floating control focus");
        add("input",`glass over ${under}`,3,token("input"),bg,"Floating form control boundary");
        probe.style.color="hsl(var(--glass-border))";
        add("glass-border",`glass over ${under}`,0,rgba(getComputedStyle(probe).color),bg,"Decorative panel edge; not a control boundary");
      }
      for (const fg of ["popover-foreground","muted-foreground","success","warning","danger","info"]) add(fg,"glass-solid",4.5,token(fg),token("glass-solid"),"Unsupported blur/reduced transparency/mobile fallback");
      probe.remove(); return out;
    }, {pairings,mode});
    rows.push(...results);
    for (const width of [390,768,1440]) {
      await page.setViewportSize({width,height:900});
      for (const [name,path] of [["dashboard","/dashboard"],["leads","/leads"],["lead-detail","/leads/1"],["pipeline","/deals"],["apply","/apply"],["settings","/settings"],["documents","/documents"],["campaigns","/campaigns"],["new-lead","/leads/new"],["sign-in","/sign-in"]]) {
        if(name === "sign-in") {
          await page.evaluate(() => window.Clerk.signOut());
        }
        await page.goto(sandbox.url+path,{waitUntil:"networkidle"});
        await waitForPage(page,name);
        const observations = await page.evaluate(() => {
          const parse = css => {
            if (css.startsWith("rgb")) return [...css.matchAll(/[\d.]+/g)].map(m=>Number(m[0]));
            const c=document.createElement("canvas");c.width=c.height=1;const x=c.getContext("2d");x.fillStyle=css;x.fillRect(0,0,1,1);const v=x.getImageData(0,0,1,1).data;return [v[0],v[1],v[2],v[3]/255];
          };
          const comp=(fg,bg)=>[0,1,2].map(i=>fg[i]*(fg[3]??1)+bg[i]*(1-(fg[3]??1))).concat(1);
          const lum=c=>c.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
          const text=[],targets=[];
          for(const el of document.querySelectorAll("body *")) {
            const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
            if(!rect.width||!rect.height||style.visibility==="hidden"||style.display==="none"||el.closest('[aria-hidden="true"]')||style.clip==="rect(0px, 0px, 0px, 0px)")continue;
            const disabled=el.closest("[disabled],[aria-disabled=true]");
            if(el.matches("button,a[href],input:not([type=hidden]),select,textarea,[role=combobox],[contenteditable=true]")) {
              targets.push({tag:el.tagName,role:el.getAttribute("role"),label:(el.getAttribute("aria-label")||el.textContent||el.getAttribute("placeholder")||"").trim().slice(0,90),width:rect.width,height:rect.height,passed:rect.width>=43.9&&rect.height>=43.9});
            }
            if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
            const ancestors=[];let node=el;
            while(node){ancestors.unshift(node);node=node.parentElement;}
            let bg=[255,255,255,1],opacity=1,gradient=false;
            for(const ancestor of ancestors){const s=getComputedStyle(ancestor);bg=comp(parse(s.backgroundColor),bg);opacity*=Number(s.opacity);if(s.backgroundImage!=="none")gradient=true;}
            let fg=parse(style.color);fg[3]=(fg[3]??1)*opacity;fg=comp(fg,bg);
            const contrast=(Math.max(lum(fg),lum(bg))+.05)/(Math.min(lum(fg),lum(bg))+.05);
            const large=Number.parseFloat(style.fontSize)>=24 || (Number.parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700);
            const threshold=large?3:4.5;
            text.push({tag:el.tagName,class:typeof el.className==="string"?el.className:"",text:el.textContent.trim().slice(0,90),color:style.color,background:bg.slice(0,3),ratio:contrast,threshold,passed:contrast>=threshold,disabled:!!disabled,gradient,font:style.fontFamily});
          }
          return {text,targets};
        });
        rendered.push({mode,width,page:name,items:observations.text});
        if(width<=768)targets.push({mode,width,page:name,items:observations.targets});
        if(name === "sign-in") {
          await page.screenshot({path:`reports/web-visual-refresh/auth-${width}-${mode}.png`});
          await sandbox.login(page);
        }
        console.log(mode,width,name,"measured");
      }
    }
    await context.close();
  }
  await mkdir("reports/web-visual-refresh",{recursive:true});
  await writeFile("reports/web-visual-refresh/contrast-tokens.json",JSON.stringify(rows,null,2));
  await writeFile("reports/web-visual-refresh/contrast-rendered.json",JSON.stringify(rendered,null,2));
  await writeFile("reports/web-visual-refresh/touch-targets.json",JSON.stringify(targets,null,2));
  console.log(JSON.stringify({tokenFailures:rows.filter(x=>!x.passed),renderedFailures:rendered.flatMap(x=>x.items.filter(i=>!i.passed&&!i.disabled).map(i=>({mode:x.mode,width:x.width,page:x.page,...i}))),targetFailures:targets.flatMap(x=>x.items.filter(i=>!i.passed).map(i=>({mode:x.mode,page:x.page,...i})))},null,2));
} finally {await browser.close();await sandbox.close();}