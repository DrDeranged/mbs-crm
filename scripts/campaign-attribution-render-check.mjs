// Cheap render regression for the Results drill-down fix; no browser or network.
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { build } = createRequire(resolve("artifacts/api-server/package.json"))("esbuild");
const outfile = resolve("artifacts/mbs-crm/node_modules/.cache/campaign-attribution-render-check.mjs");
await build({
  stdin: { contents: `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { Router } from "wouter";
    import { CampaignRepliesList } from "./src/components/campaign-replies-panel";
    import { CampaignKpiPanel } from "./src/components/campaign-metrics-panel";
    const render = child => renderToStaticMarkup(React.createElement(Router,{ssrPath:"/campaigns/1"},child));
    export const replyHtml = render(React.createElement(CampaignRepliesList, {
      isLoading:false, isError:false, onRetry(){}, replies:[{
        id:1,campaignId:1,leadId:42,emailSendId:1,fromEmail:"human@example.test",subject:"Fixture",
        bodyText:"<script>bad()</script>",receivedAt:"2026-10-01T12:00:00Z",forwardStatus:"uncertain",
        failureReason:"Held",attachments:[]}]
    }));
    export const metricHtml = render(React.createElement(CampaignKpiPanel,{
      metrics:Object.assign(Object.fromEntries(["sent","delivered","bounced","blocked","opensApproximate",
        "uniqueFlyerClicks","totalFlyerClicks","replies","calls","referredLeads","submitted","approved","funded",
        "fundedDollars","mbsPoints","unpricedFundedDeals"].map(k=>[k,0])),{
        trackingSince:"2026-10-01",replyCaptureConfigured:false,firstClickAt:null,deliveredPct:null,
        engagedLeads:[{leadId:42,label:"Synthetic lead",firstClickAt:"2026-10-01",totalFlyerClicks:3,replies:1,calls:1}]
      })
    }));
  `, resolveDir: resolve("artifacts/mbs-crm"), loader: "tsx" },
  bundle: true, packages: "external", platform: "node", format: "esm", jsx: "automatic",
  alias: { "@": resolve("artifacts/mbs-crm/src") }, outfile,
});
const { replyHtml, metricHtml } = await import(pathToFileURL(outfile).href);
assert.match(replyHtml, /href="\/leads\/42"/);
assert.match(replyHtml, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
assert.doesNotMatch(replyHtml, /<script>/);
assert.match(metricHtml, /href="\/leads\/42"/);
assert.match(metricHtml, /First flyer click/);
console.log("RESULTS RENDER CHECK PASS: replies and engagement both link to the actual lead; reply HTML is escaped.");
