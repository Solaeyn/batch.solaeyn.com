const getCookieValue=n=>{const t=`${encodeURIComponent(n)}=`,e=document.cookie?document.cookie.split(";"):[];for(const a of e){const s=a.trim();if(s.startsWith(t))return decodeURIComponent(s.slice(t.length))}return""},api=async(n,t={})=>{const e=new Headers(t.headers||{});e.has("Content-Type")||e.set("Content-Type","application/json");const a=getCookieValue("csrfToken");a&&e.set("x-csrf-token",a);const s=await fetch(n,{credentials:"same-origin",...t,headers:e});let r={};return(s.headers.get("content-type")||"").includes("application/json")&&(r=await s.json()),{ok:s.ok,status:s.status,data:r}},escapeHtml=n=>String(n??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"),formatDate=n=>{if(!n)return"Never";const t=new Date(n);return Number.isNaN(t.getTime())?"Never":t.toLocaleString(void 0,{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"})},setText=(n,t)=>{const e=document.getElementById(n);e&&(e.textContent=t)},renderRecent=n=>{const t=document.getElementById("recentScripts");if(t){if(!n.length){t.innerHTML='<p class="empty-state">No scripts yet. <a href="/home/builder">Build your first one.</a></p>';return}t.innerHTML=n.map(e=>`
        <article class="script-card">
          <div class="script-card-main">
            <h3>${escapeHtml(e.name)}</h3>
            ${e.description?`<p>${escapeHtml(e.description)}</p>`:""}
            <div class="script-card-meta">
              <span>${e.blockCount} block${e.blockCount===1?"":"s"}</span>
              <span>Edited ${escapeHtml(formatDate(e.updatedAt))}</span>
            </div>
          </div>
          <div class="script-card-actions">
            <a class="btn-xs" href="/home/builder?script=${e.id}">Edit</a>
            <a class="btn-xs" href="/api/scripts/${e.id}/download">Download</a>
          </div>
        </article>
      `).join("")}},load=async()=>{const n=await api("/api/dashboard/overview");if(n.status===401||n.status===403){window.location.href="/login";return}if(!n.ok)return;const t=n.data.overview||{},e=n.data.recent||[];setText("statScripts",String(t.totalScripts??0)),setText("statBlocks",String(t.totalBlocks??0)),setText("statLimit",String(t.maxScripts??"--")),setText("statLast",formatDate(t.lastUpdatedAt)),setText("overviewUpdated",t.totalScripts?`${t.totalScripts} saved`:"Empty"),renderRecent(e)};load();
