import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, CheckCircle, Loader2, AlertCircle, RefreshCw } from 'lucide-react';

export default function App() {
  const [status, setStatus] = useState<'idle' | 'loading_model' | 'ready' | 'decoding' | 'transcribing' | 'complete' | 'error'>('idle');
  const [progressMsg, setProgressMsg] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [transcript, setTranscript] = useState<{ text: string, chunks?: { text: string, timestamp: [number, number] }[] } | null>(null);
  
  const workerRef = useRef<Worker>(null);
  const audioCtxRef = useRef<AudioContext>(null);

  useEffect(() => {
    // @ts-ignore - Initialize Web Worker
    workerRef.current = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    
    if (workerRef.current) {
      workerRef.current.onmessage = (e) => {
        const { status: msgStatus, message, info, result } = e.data;

        if (msgStatus === 'loading') {
          setStatus('loading_model');
          setProgressMsg(message);
        } else if (msgStatus === 'progress' && info) {
          if (info.status === 'init' || info.status === 'progress' || info.status === 'downloading') {
             if (info.name && info.progress !== undefined) {
               setDownloadProgress(Math.round(info.progress));
               setProgressMsg(`Downloading model files... ${Math.round(info.progress)}%`);
             }
          } else if (info.status === 'done') {
             setDownloadProgress(100);
          }
        } else if (msgStatus === 'ready') {
          setStatus('ready');
          setProgressMsg('');
          setDownloadProgress(0);
        } else if (msgStatus === 'transcribing') {
          setStatus('transcribing');
          setProgressMsg('Transcribing audio using Whisper model...');
        } else if (msgStatus === 'complete') {
          setStatus('complete');
          setTranscript(result);
          setProgressMsg('');
        } else if (msgStatus === 'error') {
          setStatus('error');
          setErrorMsg(message);
        }
      };

      // Auto-load model on start
      workerRef.current.postMessage({ type: 'load' });
    }

    return () => {
      workerRef.current?.terminate();
      if (audioCtxRef.current?.state !== 'closed') {
        audioCtxRef.current?.close().catch(console.error);
      }
    };
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
       setStatus('error');
       setErrorMsg('Please upload a valid audio or video file.');
       return;
    }

    try {
      setTranscript(null);
      setErrorMsg('');
      setStatus('decoding');
      setProgressMsg('Extracting audio from file...');

      // Decode audio
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass({ sampleRate: 16000 });
      // @ts-ignore
      audioCtxRef.current = audioCtx;

      const arrayBuffer = await file.arrayBuffer();
      const decodedData = await audioCtx.decodeAudioData(arrayBuffer);
      const audioData = decodedData.getChannelData(0); // Float32Array
      
      // Send to worker
      workerRef.current?.postMessage({
        type: 'transcribe',
        data: { audio: audioData }
      });
      
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMsg(`Failed to extract audio: ${err.message || 'Unknown error. Make sure the file is a valid MP4/Audio.'}`);
    }
  };

  const reset = () => {
    setTranscript(null);
    setErrorMsg('');
    setStatus('ready');
    setProgressMsg('');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 bg-indigo-100 text-indigo-600 rounded-full flex flex-col items-center justify-center">
            <CheckCircle className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-4xl font-extrabold text-slate-900 tracking-tight">Free Local Video Transcriber</h2>
          <p className="mt-2 text-lg text-slate-600">
            Convert MP4 video audio to text directly in your browser. 
            <br className="max-sm:hidden" />
            No API limits, no accounts, entirely offline and private.
          </p>
        </div>

        <div className="bg-white shadow-xl rounded-2xl overflow-hidden border border-slate-100">
          <div className="p-8">
            {/* Model Loading State */}
            {['idle', 'loading_model'].includes(status) && (
               <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
                  <Loader2 className="h-10 w-10 text-indigo-500 animate-spin mb-4" />
                  <p className="text-lg font-medium text-slate-700">Loading AI Model (Whisper)</p>
                  <p className="text-sm mt-1">{progressMsg || 'Initializing WebAssembly...'}</p>
                  {downloadProgress > 0 && downloadProgress < 100 && (
                    <div className="w-full max-w-xs bg-slate-200 rounded-full h-2.5 mt-4">
                      <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${downloadProgress}%` }}></div>
                    </div>
                  )}
               </div>
            )}

            {/* Ready for Upload State */}
            {status === 'ready' && (
              <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-slate-300 border-dashed rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-12 h-12 text-slate-400 mb-4" />
                  <p className="mb-2 text-lg text-slate-700 font-medium"><span className="font-semibold text-indigo-600">Click to upload</span> or drag and drop</p>
                  <p className="text-sm text-slate-500">MP4, WEBM, MOV, MP3, WAV</p>
                </div>
                <input type="file" accept="video/*,audio/*" className="hidden" onChange={handleFileUpload} />
              </label>
            )}

            {/* Processing State */}
            {['decoding', 'transcribing'].includes(status) && (
               <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Loader2 className="h-12 w-12 text-indigo-500 animate-spin mb-4" />
                  <p className="text-xl font-medium text-slate-900">{status === 'decoding' ? 'Extracting Audio...' : 'Transcribing Speech to Text'}</p>
                  <p className="mt-2 text-slate-500">{progressMsg || 'This may take a few moments depending on video length and your device.'}</p>
               </div>
            )}

            {/* Error State */}
            {status === 'error' && (
               <div className="flex flex-col items-center justify-center py-12 text-center">
                 <div className="h-16 w-16 bg-red-50 rounded-full flex flex-col items-center justify-center mb-4">
                    <AlertCircle className="h-8 w-8 text-red-500" />
                 </div>
                 <h3 className="text-lg font-medium text-slate-900 mb-2">Something went wrong</h3>
                 <p className="text-slate-600 max-w-md">{errorMsg}</p>
                 <button onClick={reset} className="mt-6 flex flex-row items-center space-x-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors">
                   <RefreshCw className="h-4 w-4" />
                   <span>Try again</span>
                 </button>
               </div>
            )}

            {/* Complete State */}
            {status === 'complete' && transcript && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-row items-center justify-between mb-6">
                   <div className="flex flex-row items-center space-x-3 text-emerald-600">
                     <CheckCircle className="h-6 w-6" />
                     <h3 className="text-lg font-semibold">Transcription Complete</h3>
                   </div>
                   <button onClick={reset} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                     Transcribe another file
                   </button>
                </div>
                
                <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
                  {transcript.chunks && transcript.chunks.length > 0 ? (
                    <div className="space-y-4">
                       {transcript.chunks.map((chunk, i) => (
                         <div key={i} className="flex flex-row gap-4">
                           <span className="text-xs font-mono text-slate-400 mt-1 whitespace-nowrap">
                             [{new Date(chunk.timestamp[0] * 1000).toISOString().substring(14, 19)}]
                           </span>
                           <p className="text-slate-800 leading-relaxed font-sans">{chunk.text}</p>
                         </div>
                       ))}
                    </div>
                  ) : (
                    <p className="text-slate-800 leading-relaxed whitespace-pre-wrap">{transcript.text}</p>
                  )}
                </div>

                <div className="mt-6 flex flex-row gap-3">
                   <button 
                     onClick={() => {
                        const blob = new Blob([transcript.text], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `transcript-${Date.now()}.txt`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                     }}
                     className="flex-1 flex flex-row items-center justify-center space-x-2 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition"
                   >
                     <FileText className="h-5 w-5" />
                     <span>Download .TXT</span>
                   </button>
                </div>
              </div>
            )}
          </div>
          
          <div className="bg-slate-50 border-t border-slate-100 p-4 text-center">
            <p className="text-xs text-slate-500 flex flex-row items-center justify-center space-x-1">
              <span>Powered by</span>
              <a href="https://huggingface.co/docs/transformers.js" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center">
                transformers.js
              </a>
              <span>and Whisper</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

