/** Client-side validation; server validation and access checks remain authoritative. */
export function makeDraftKey(crypto=globalThis.crypto){
 if(typeof crypto?.randomUUID==='function')return crypto.randomUUID();
 if(typeof crypto?.getRandomValues!=='function')throw Error('SECURE_RANDOM_UNAVAILABLE');
 return Array.from(crypto.getRandomValues(new Uint8Array(24)),n=>n.toString(16).padStart(2,'0')).join('');
}
export function parseAccessPrice(raw){
 if(typeof raw!=='string'||!/^\d{1,8}$/.test(raw.trim()))return null;
 const amount=Number(raw.trim());
 return Number.isSafeInteger(amount)&&amount<=10000000&&(amount===0||amount>=200)?amount*100:null;
}
export function mediaSelectionError(file,kind){
 if(!file)return kind==='video'?'Select a video before uploading.':'Choose an English WebVTT captions file.';
 if(kind==='video')return file.type!=='video/mp4'||file.size<=0||file.size>25*1024*1024?'Choose a nonempty MP4 file no larger than 25 MiB.':null;
 if(kind==='captions')return !file.name.toLowerCase().endsWith('.vtt')||file.size<25||file.size>128*1024?'Choose a plain-text .vtt file between 25 bytes and 128 KiB.':null;
 throw Error('UNKNOWN_MEDIA_KIND');
}
export function submissionBlock({item,editingId,priceInput,videoFile,captionFile}){
 if(editingId===item.id)return 'Save or cancel the open edit before submitting.';
 if(parseAccessPrice(priceInput??String((item.priceKobo??0)/100))!==(item.priceKobo??0))return 'Save a valid access price before submitting.';
 if(videoFile||captionFile)return 'Upload or remove selected media before submitting.';
 return null;
}
