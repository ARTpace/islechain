/* Uncompressed ZIP and RGB PSD v1; no runtime dependency. PSD layers retain source coordinates. */
(()=>{'use strict';
 const enc=new TextEncoder();
 const join=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
 function num(value,size,le=false){const out=new Uint8Array(size),v=new DataView(out.buffer);if(size===2)v.setUint16(0,value,le);else v.setUint32(0,value,le);return out;}
 const str=s=>enc.encode(s),u16=n=>num(n,2),u32=n=>num(n,4);
 const block=bytes=>join([u32(bytes.length),bytes]);
 function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
 function zip(files){let offset=0;const local=[],central=[];for(const file of files){const name=str(file.name),data=file.bytes,c=crc(data),size=data.length;
  const head=join([num(0x04034b50,4,true),num(20,2,true),num(0x800,2,true),num(0,2,true),num(0,2,true),num(33,2,true),num(c,4,true),num(size,4,true),num(size,4,true),num(name.length,2,true),num(0,2,true),name]);
  local.push(head,data);central.push(join([num(0x02014b50,4,true),num(20,2,true),num(20,2,true),head.slice(6,28),num(0,2,true),num(0,2,true),num(0,2,true),num(0,2,true),num(0,4,true),num(offset,4,true),name]));offset+=head.length+size;
 }const directory=join(central);return new Blob([...local,directory,join([num(0x06054b50,4,true),num(0,2,true),num(0,2,true),num(files.length,2,true),num(files.length,2,true),num(directory.length,4,true),num(offset,4,true),num(0,2,true)])],{type:'application/zip'});}
 function psd(width,height,pieces){
  if(width>30000||height>30000||pieces.length>32767)throw Error('图片或图层数量超过 PSD 限制');
  const records=[],channels=[];
  for(const p of pieces){const count=p.w*p.h,info=[];for(const id of [0,1,2,-1]){const plane=new Uint8Array(count+2),channel=id===-1?3:id;for(let i=0;i<count;i++)plane[i+2]=p.image.data[i*4+channel];info.push(u16(id),u32(plane.length));channels.push(plane);}
   const name=str(p.name||p.id).slice(0,255),pascal=new Uint8Array(Math.ceil((name.length+1)/4)*4);pascal[0]=name.length;pascal.set(name,1);
   // Unicode layer names are stored separately from the Pascal fallback.
   const title=p.name||p.id,unicode=join([u32(title.length),...Array.from({length:title.length},(_,i)=>u16(title.charCodeAt(i)))]);
   const extra=join([u32(0),u32(0),pascal,str('8BIMluni'),u32(unicode.length),unicode,...(unicode.length%2?[new Uint8Array(1)]:[])]);
   records.push(join([u32(p.y),u32(p.x),u32(p.y+p.h),u32(p.x+p.w),u16(4),...info,str('8BIMnorm'),new Uint8Array([255,0,8,0]),block(extra)]));
  }
  let layer=join([u16(-pieces.length),...records,...channels]);if(layer.length%2)layer=join([layer,new Uint8Array(1)]);
  const merged=new Uint8Array(width*height*4);
  // Disjoint split components preserve their original positions and alpha.
  for(const p of [...pieces].reverse())for(let y=0;y<p.h;y++)for(let x=0;x<p.w;x++){const si=(y*p.w+x)*4,di=((p.y+y)*width+p.x+x)*4;if(p.image.data[si+3])merged.set(p.image.data.subarray(si,si+4),di);}
  const planes=[];for(let c=0;c<4;c++){const plane=new Uint8Array(width*height);for(let i=0;i<plane.length;i++)plane[i]=merged[i*4+c];planes.push(plane);}
  return new Blob([str('8BPS'),u16(1),new Uint8Array(6),u16(4),u32(height),u32(width),u16(8),u16(3),u32(0),u32(0),block(join([block(layer),u32(0)])),u16(0),...planes],{type:'image/vnd.adobe.photoshop'});
 }
 window.AssetSplitExport={zip,psd};
})();
