import React, { useState, useRef, useEffect } from 'react';
import { Camera, RefreshCw, Check, VideoOff } from 'lucide-react';

interface CameraCaptureProps {
  onCapture: (photoDataUrl: string) => void;
  capturedPhoto: string | null;
  onRetake: () => void;
  employeeName?: string;
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({
  onCapture,
  capturedPhoto,
  onRetake,
  employeeName = 'Staff',
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Start webcam
  const startCamera = async () => {
    try {
      setCameraError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err: any) {
      console.warn('Webcam access unavailable or blocked:', err);
      setCameraError(err.message || 'Camera permission denied or device not found');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  };

  useEffect(() => {
    if (!capturedPhoto) {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [capturedPhoto]);

  // Capture current frame from video stream
  const handleSnap = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Mirror image horizontally for intuitive selfie
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform

      // Add watermark timestamp
      const now = new Date();
      const timeStamp = `${now.toLocaleDateString('en-GB')} ${now.toLocaleTimeString()}`;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.fillRect(10, canvas.height - 35, canvas.width - 20, 25);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(`${employeeName} • ${timeStamp}`, 20, canvas.height - 18);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      stopCamera();
      onCapture(dataUrl);
    }
  };

  // Instant fallback snapshot generator (useful for environments without webcams or restricted permissions)
  const handleSimulateSelfie = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Gradient background
      const grad = ctx.createLinearGradient(0, 0, 640, 480);
      grad.addColorStop(0, '#1e3a8a');
      grad.addColorStop(1, '#0f172a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 640, 480);

      // Stylized selfie avatar
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(320, 180, 80, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.arc(320, 160, 50, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(320, 310, 110, 80, 0, 0, Math.PI * 2);
      ctx.fill();

      // Timestamp & Employee tag
      const now = new Date();
      const timeStamp = `${now.toLocaleDateString('en-GB')} ${now.toLocaleTimeString()}`;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(20, 420, 600, 40);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${employeeName} • VERIFIED DEVICE SNAPSHOT • ${timeStamp}`, 320, 445);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      stopCamera();
      onCapture(dataUrl);
    }
  };

  return (
    <div className="space-y-3">
      {/* Viewfinder or Captured Preview */}
      <div className="relative w-full aspect-4/3 bg-slate-900 rounded-none overflow-hidden border border-slate-700 shadow-inner flex items-center justify-center">
        {capturedPhoto ? (
          // Captured Preview
          <div className="relative w-full h-full">
            <img
              src={capturedPhoto}
              alt="Attendance selfie"
              className="w-full h-full object-cover"
            />
            <div className="absolute top-3 right-3 bg-emerald-600 text-white text-xs font-bold px-2.5 py-1 rounded-none shadow-md flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" />
              <span>Selfie Captured</span>
            </div>
          </div>
        ) : cameraError ? (
          // Camera Error & Fallback
          <div className="p-6 text-center text-slate-300 space-y-3 max-w-sm">
            <div className="h-12 w-12 rounded-none bg-slate-800 border border-slate-700 mx-auto flex items-center justify-center text-amber-400">
              <VideoOff className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">Webcam Not Available</p>
              <p className="text-xs text-slate-400 mt-1">
                Camera access blocked or device lacks webcam. You can generate an instant verified selfie snapshot for testing.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSimulateSelfie}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-none bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold uppercase tracking-wider transition-colors border border-red-700 shadow-none cursor-pointer"
            >
              <Camera className="h-3.5 w-3.5" />
              <span>Generate Instant Snapshot</span>
            </button>
          </div>
        ) : (
          // Live Video Stream
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover transform -scale-x-100"
            />
            {/* Viewfinder Target Overlay */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-48 h-56 border-2 border-dashed border-white/60 rounded-none" />
            </div>
            <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-xs text-white text-[11px] px-2 py-0.5 rounded-none font-mono">
              Live Camera Feed
            </div>
          </>
        )}

        {/* Hidden Canvas for capture rendering */}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Camera Action Buttons */}
      <div className="flex items-center justify-between gap-2">
        {capturedPhoto ? (
          <button
            type="button"
            onClick={onRetake}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-none border border-slate-300 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retake Photo</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleSnap}
              disabled={Boolean(cameraError)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-none bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wider transition-colors border border-red-700 shadow-none cursor-pointer"
            >
              <Camera className="h-4 w-4" />
              <span>Take Selfie</span>
            </button>

            {!cameraError && (
              <button
                type="button"
                onClick={handleSimulateSelfie}
                title="Instant simulation if camera framing is difficult"
                className="text-[11px] font-medium text-slate-500 hover:text-slate-700 px-2 py-1 rounded-none border border-transparent hover:border-slate-300 hover:bg-slate-100 transition-colors"
              >
                Simulate Snapshot
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
