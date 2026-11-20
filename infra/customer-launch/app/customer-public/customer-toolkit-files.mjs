// Actual client-side Microsoft Word/Excel export using the already-bundled JSZip vendor.
const x=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const getZip=()=>{const c=globalThis.JSZip;if(typeof c!=='function')throw Error('FILE_EXPORT_LIBRARY_NOT_READY');return new c()};
const colNumber=i=>{let str='';for(let n=i;n>=0;n=Math.floor(n/26)-1)str=String.fromCharCode(65+n%26)+str;return str};
export async function docxFile(title,sections){
 if(typeof title!=='string'||title.length>200||!Array.isArray(sections)||sections.length>30)throw Error('DOCUMENT_INVALID');
 const blocks=[[title,true],...sections.flatMap(item=>{
  if(!Array.isArray(item)||item.length!==2)return [];
  return [[String(item[0]).slice(0,180),true],[String(item[1]).slice(0,2500),false]]
 })];
 const paragraphs=blocks.map(([line,heading])=>
  '<w:p>'+(heading?'<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>':'')+
  '<w:r><w:t xml:space="preserve">'+x(line)+'</w:t></w:r></w:p>').join('');
 const z=getZip();
 z.file('[Content_Types].xml',XML+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
 z.file('_rels/.rels',XML+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 z.file('word/document.xml',XML+'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+paragraphs+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>');
 z.file('word/_rels/document.xml.rels',XML+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
 z.file('word/styles.xml',XML+'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="180" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="27"/></w:rPr></w:style></w:styles>');
 return z.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
}
export async function xlsxFile(rows,{sheetName='계획표'}={}){
 if(!Array.isArray(rows)||!rows.length||rows.length>700||rows.some(r=>!Array.isArray(r)||r.length>32))throw Error('SHEET_INVALID');
 const safeName=String(sheetName).replace(/[\[\]:*?\/\\]/g,'').slice(0,30)||'Sheet1';
 const rowXml=rows.map((row,r)=>'<row r="'+(r+1)+'">'+row.map((val,c)=>{
  let s=String(val??'');
  if(s.length>2500)throw Error('CELL_TOO_LARGE');
  const ref=colNumber(c)+(r+1);
  // Do not interpret any user input as an Excel formula.
  if(r>0&&typeof val==='number'&&Number.isFinite(val))return '<c r="'+ref+'"><v>'+val+'</v></c>';
  return '<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+x(s)+'</t></is></c>';
 }).join('')+'</row>').join('');
 const z=getZip();
 z.file('[Content_Types].xml',XML+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
 z.file('_rels/.rels',XML+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
 z.file('xl/workbook.xml',XML+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="'+x(safeName)+'" sheetId="1" r:id="rId1"/></sheets></workbook>');
 z.file('xl/_rels/workbook.xml.rels',XML+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
 z.file('xl/worksheets/sheet1.xml',XML+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>'+rowXml+'</sheetData></worksheet>');
 z.file('xl/styles.xml',XML+'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Malgun Gothic"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>');
 return z.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
}
export function saveBlob(name,data,type='text/plain;charset=utf-8'){
 if(typeof document==='undefined')throw Error('BROWSER_REQUIRED');
 const filename=String(name).replace(/[^A-Za-z0-9가-힣_.-]/g,'_').slice(0,90);
 if(!filename||filename.includes('..'))throw Error('FILENAME_INVALID');
 const file=data instanceof Blob?data:new Blob([data],{type});
 const link=document.createElement('a'),url=URL.createObjectURL(file);
 link.href=url;link.download=filename;link.style.display='none';
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),8000);
 return {name:filename,bytes:file.size};
}
