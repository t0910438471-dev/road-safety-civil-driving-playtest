(function(root){
  'use strict';
  function createStageDownloader(engine, stages, options={}){
    const transport=options.transport || root.RoadBootDownload;
    const report=options.onState || (()=>{});
    const installed=new Set();
    let active;
    const notify=(job,phase,current=job.current)=>report({stageId:job.id,phase,current,total:job.total});
    function settle(job,accepted){
      if(active!==job)return;
      active=undefined;
      for(const callback of job.callbacks)callback(accepted,accepted?job.file.name:'');
    }
    async function run(job){
      const controller=new AbortController();job.controller=controller;job.current=0;
      notify(job,'download');
      try{
        const files=await transport.downloadFiles([job.file],{...options,signal:controller.signal,
          onProgress:current=>{job.current=current;if(active===job&&!controller.signal.aborted)notify(job,'download');}});
        if(active!==job||controller.signal.aborted){files.clear();return;}
        notify(job,'install');
        try{engine.copyToFS(job.file.name,files.get(job.file.name).buffer);}finally{files.clear();}
        installed.add(job.id);notify(job,'ready');settle(job,true);
      }catch(error){
        if(active!==job||controller.signal.aborted)return;
        job.failed=true;notify(job,'failed');
      }
    }
    return {
      prepare(id,callback){
        if(typeof callback!=='function')return;
        const file=Object.hasOwn(stages,id)?stages[id]:undefined;
        if(!file){callback(false,'');return;}
        if(installed.has(id)){callback(true,file.name);return;}
        if(active){if(active.id===id)active.callbacks.push(callback);else callback(false,'');return;}
        const job={id,file,callbacks:[callback],total:transport.getDownloadSize(file),current:0,failed:false};
        active=job;void run(job);
      },
      retry(){if(active?.failed){active.failed=false;void run(active);}},
      cancel(){if(active){const job=active;job.controller.abort();notify(job,'cancelled');settle(job,false);}},
    };
  }
  function configure(engine,stages,options={}){
    if(!stages || !Object.keys(stages).length)return;
    const overlay=document.createElement('section');
    overlay.setAttribute('aria-label','關卡載入');overlay.hidden=true;
    overlay.style.cssText='position:fixed;inset:0;z-index:1000;background:#081522df;display:none;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;';
    const card=document.createElement('div');
    card.style.cssText='width:min(100%,360px);padding:24px;box-sizing:border-box;border:2px solid #5cbada;border-radius:22px;background:linear-gradient(#254d68,#132d43);box-shadow:0 8px 0 #071520;color:#fff;text-align:center;font-family:system-ui;';
    const label=document.createElement('h2');label.setAttribute('role','status');
    const progress=document.createElement('progress');progress.max=100;progress.style.width='100%';progress.setAttribute('aria-label','關卡下載進度');
    const detail=document.createElement('p');detail.style.cssText='line-height:1.6;font-size:16px;';
    const retry=document.createElement('button');retry.textContent='重新嘗試';retry.hidden=true;
    const cancel=document.createElement('button');cancel.textContent='返回地圖';
    for(const button of [retry,cancel]){button.type='button';button.style.cssText='margin:8px;padding:12px 20px;border-radius:12px;border:2px solid #77d3ee;background:#1b5377;color:white;font:700 18px system-ui;box-shadow:0 4px 0 #071520;';}
    card.append(label,progress,detail,retry,cancel);overlay.append(card);document.body.append(overlay);
    const downloader=createStageDownloader(engine,stages,{...options,onState:s=>{
      const visible=!['ready','cancelled'].includes(s.phase);
      overlay.hidden=!visible;overlay.style.display=visible?'flex':'none';
      retry.hidden=s.phase!=='failed';
      const number=Number(s.stageId.slice(5));
      label.textContent=s.phase==='failed'?'關卡下載未完成':s.phase==='install'?'正在準備關卡':`正在載入第${number}關`;
      progress.value=Math.floor(s.current*100/s.total);
      detail.textContent=s.phase==='failed'?'請檢查網路後重試，或返回地圖。原有進度會保留。':`${(s.current/1000000).toFixed(1)} / ${(s.total/1000000).toFixed(1)} MB・只下載本關環境`;
      if(visible)cancel.focus({preventScroll:true});
      else document.getElementById('canvas')?.focus({preventScroll:true});
    }});
    retry.addEventListener('click',()=>downloader.retry());cancel.addEventListener('click',()=>downloader.cancel());
    window.addEventListener('keydown',event=>{
      if(overlay.hidden)return;
      if(event.code==='Escape'){event.preventDefault();event.stopImmediatePropagation();downloader.cancel();}
      else if(!['Tab','Enter','Space'].includes(event.code)){event.preventDefault();event.stopImmediatePropagation();}
      else event.stopPropagation();
    },{capture:true});
    window.addEventListener('pagehide',()=>downloader.cancel(),{once:true});
    root.RoadStageDownload=downloader;
  }
  const api={createStageDownloader,configure};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.RoadStageDownload=api;
})(globalThis);
