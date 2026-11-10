const root=document.getElementById('devlog');
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
async function load(){
  const response=await fetch('/post/devlog.json');
  if(!response.ok)throw new Error('Build log unavailable');
  const data=await response.json();
  if(data.version!==1||!Array.isArray(data.entries))throw new Error('Build log format unavailable');
  const count=document.getElementById('release-count');
  if(count)count.textContent=`${String(data.entries.length).padStart(2,'0')} VERIFIED MILESTONES`;
  root.replaceChildren();
  for(const [index,item] of data.entries.entries()){
    const article=element('article','entry');
    article.dataset.entry=String(index+1);
    article.append(element('div','entry-index',String(index+1).padStart(2,'0')));
    const body=element('div','entry-body');
    body.append(element('p','entry-meta',`${item.date} · SHIPPED`),element('h2','',item.title),element('p','entry-summary',item.summary));
    const details=element('details','entry-details');details.append(element('summary','', 'Technical notes'));
    for(const paragraph of item.detail.split(/\n\s*\n/))details.append(element('p','',paragraph.replace(/^##\s+/gm,'')));
    body.append(details);
    const commit=element('a','commit-link','Source commit ↗');commit.href=item.commit;commit.rel='noreferrer';body.append(commit);
    if(item.pr){const pr=element('a','commit-link secondary','Pull request ↗');pr.href=item.pr;pr.rel='noreferrer';body.append(pr);}
    article.append(body);root.append(article);
  }
  setupEntryGlow();
  document.dispatchEvent(new Event('motion:scan'));
}
function setupEntryGlow(){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  for(const entry of root.querySelectorAll('.entry')){
    entry.addEventListener('pointermove',event=>{
      const rect=entry.getBoundingClientRect();
      entry.style.setProperty('--pointer-x',`${event.clientX-rect.left}px`);
      entry.style.setProperty('--pointer-y',`${event.clientY-rect.top}px`);
    });
  }
}
load().catch(error=>{root.replaceChildren(element('p','',error.message));});
