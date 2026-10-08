const root=document.getElementById('devlog');
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
async function load(){
  const response=await fetch('/post/devlog.json');
  if(!response.ok)throw new Error('Build log unavailable');
  const data=await response.json();
  if(data.version!==1||!Array.isArray(data.entries))throw new Error('Build log format unavailable');
  root.replaceChildren();
  for(const [index,item] of data.entries.entries()){
    const article=element('article','entry');
    article.append(element('div','entry-index',String(index+1).padStart(2,'0')));
    const body=element('div','entry-body');
    body.append(element('p','entry-meta',item.date),element('h2','',item.title),element('p','',item.summary));
    const details=element('details','entry-details');details.append(element('summary','', 'Technical notes'));
    for(const paragraph of item.detail.split(/\n\s*\n/))details.append(element('p','',paragraph.replace(/^##\s+/gm,'')));
    body.append(details);
    const commit=element('a','commit-link','Source commit ↗');commit.href=item.commit;commit.rel='noreferrer';body.append(commit);
    if(item.pr){const pr=element('a','commit-link secondary','Pull request ↗');pr.href=item.pr;pr.rel='noreferrer';body.append(pr);}
    article.append(body);root.append(article);
  }
}
load().catch(error=>{root.replaceChildren(element('p','',error.message));});
