export const COLUMNS=['nome','cpf','telefone','whatsapp','email','nascimento','bairro','municipio','uf'];
const KEYS=['name','cpf','phone','whatsapp','email','dob','bairro','cidade','estado'];
const aliases={name:'nome',phone:'telefone',dob:'nascimento',cidade:'municipio',estado:'uf',e_mail:'email',data_nascimento:'nascimento'};
export const CSV_MODEL=COLUMNS.join(';')+'\r\n';
// CSV UTF-8, campos entre aspas, aspas escapadas e quebras de linha internas.
export function parseImportCSV(text){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>1048576)throw new Error('O CSV deve ter até 1 MB.');
 text=text.replace(/^\uFEFF/,'');
 let quoted=false,first='';for(let i=0;i<text.length;i++){if(text[i]==='"')quoted=!quoted;if(!quoted&&/[\r\n]/.test(text[i]))break;first+=text[i];}
 const delimiter=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';
 const rows=[];let row=[],cell='',inQuotes=false,closed=false;
 function field(){row.push(cell);cell='';closed=false;}
 function record(){field();if(row.some(v=>v.trim()!==''))rows.push(row);row=[];if(rows.length>501)throw new Error('O limite é de 500 cidadãos por arquivo.');}
 for(let i=0;i<text.length;i++){
  const c=text[i];if(inQuotes){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{inQuotes=false;closed=true;}}else cell+=c;continue;}
  if(c==='"'){if(cell||closed)throw new Error('Aspas inválidas no CSV.');inQuotes=true;}
  else if(c===delimiter)field();else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;record();}
  else {if(closed)throw new Error('Conteúdo após fechamento de aspas.');cell+=c;}
 }
 if(inQuotes)throw new Error('Campo com aspas não foi fechado.');if(cell||row.length||closed)record();
 if(rows.length<2)throw new Error('O arquivo precisa de cabeçalho e pelo menos um cidadão.');
 const header=rows.shift().map(v=>{let key=v.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[ -]+/g,'_');return aliases[key]||key;});
 if(!header.includes('nome'))throw new Error('Cabeçalho obrigatório: nome.');
 if(new Set(header).size!==header.length)throw new Error('Existem colunas repetidas.');
 for(const h of header)if(!COLUMNS.includes(h))throw new Error(`Coluna desconhecida: ${h}. Use o modelo.`);
 return rows.map((values,i)=>{if(values.length!==header.length)throw new Error(`Registro ${i+1}: quantidade de colunas diferente do cabeçalho.`);return Object.fromEntries(header.map((h,j)=>[KEYS[COLUMNS.indexOf(h)],values[j].trim()]));});
}
