'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  Download, 
  RefreshCw, 
  AlertTriangle, 
  AlertCircle,
  Copy, 
  Check, 
  Sparkles, 
  Upload, 
  Clock,
  X,
  FileSpreadsheet,
  ZoomIn,
  ZoomOut,
  Trash2,
  Plus,
  ClipboardCopy,
  Maximize2,
  ShieldAlert,
  SlidersHorizontal
} from 'lucide-react';
import { ExtractionResult, MedicineItem } from '@/lib/types';
import { uploadPrescription, pollResult, exportPdf, exportPdfFromResult } from '@/lib/api';

const EMPTY_RESULT: ExtractionResult = {
  id: '',
  patient_name: '',
  date: '',
  doctor_name: '',
  doctor_reg_no: '',
  general_instructions: '',
  followup_date: '',
  ocr_raw: '',
  ocr_confidence: 0,
  extraction_failures: [],
  processing_time_ms: 0,
  model_used: 'qwen/qwen3.8-27b',
  medicines: [],
};

interface PrescriptionWorkspaceProps {
  initialTaskId?: string;
}

export default function PrescriptionWorkspace({ initialTaskId }: PrescriptionWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<'record' | 'json'>('record');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<'idle' | 'reading' | 'structuring' | 'checking' | 'done'>('idle');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isSummaryCopied, setIsSummaryCopied] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // Zoom Lightbox state
  const [isZoomOpen, setIsZoomOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Confidence sensitivity threshold (70% - 90%)
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.80);

  // Editable record fields
  const [record, setRecord] = useState<ExtractionResult>(EMPTY_RESULT);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clinical safety and interaction checks
  const checkDrugInteractions = (medicines: MedicineItem[]): string[] => {
    const alerts: string[] = [];
    const lowerNames = medicines.map(m => (m.name || '').toLowerCase());
    
    // Check NSAID / Analgesic duplicates
    const nsaids = ['paracetamol', 'ibuprofen', 'diclofenac', 'aceclofenac', 'naproxen', 'combiflam', 'dolo', 'crocin', 'calpol'];
    const matchedNsaids = Array.from(new Set(lowerNames.filter(name => nsaids.some(n => name.includes(n)))));
    if (matchedNsaids.length > 1) {
      alerts.push(`Multiple analgesics/antipyretics detected (${matchedNsaids.join(', ')}). Monitor total cumulative daily dosage.`);
    }

    // Check PPI / Antacid duplicates
    const ppis = ['rabeprazole', 'rabemar', 'pantoprazole', 'pan ', 'pan-', 'omeprazole', 'esomeprazole', 'rantac', 'ranitidine', 'famotidine'];
    const matchedPpis = Array.from(new Set(lowerNames.filter(name => ppis.some(p => name.includes(p)))));
    if (matchedPpis.length > 1) {
      alerts.push(`Multiple acid suppressants/PPIs prescribed (${matchedPpis.join(', ')}). Check for overlapping indications.`);
    }

    // Check Multivitamin with antibiotic spacing
    const multivits = ['zincovit', 'becosules', 'supradyn', 'multivitamin', 'iron', 'calcium'];
    const hasMultivit = lowerNames.some(name => multivits.some(v => name.includes(v)));
    const hasAntibiotic = lowerNames.some(name => ['cipro', 'doxy', 'azithro', 'amox', 'cefix', 'levo', 'oflox'].some(a => name.includes(a)));
    if (hasMultivit && hasAntibiotic) {
      alerts.push('Minerals in multivitamin (Zinc/Iron/Calcium) may reduce antibiotic absorption if taken together. Space doses by at least 2 hours.');
    }

    return alerts;
  };

  // Calculate items requiring human look based on dynamic threshold or Indian DB verification
  const itemsNeedingReview = record.medicines.filter(
    (m) => m.confidence < confidenceThreshold || m.status === 'confirm' || m.status === 'not_found' || (!m.fda_verified && !m.india_db_verified)
  );
  const safetyAlerts = checkDrugInteractions(record.medicines);

  // Quick candidate auto-fix click
  const handleCandidateClick = (index: number, candidate: string) => {
    const updated = [...record.medicines];
    updated[index] = {
      ...updated[index],
      name: candidate,
      status: 'matched',
      india_db_verified: true,
      matched_name: candidate,
    };
    setRecord({ ...record, medicines: updated });
  };

  // If initialTaskId is provided, poll for that task on mount
  useEffect(() => {
    if (initialTaskId) {
      pollExistingTask(initialTaskId);
    }
  }, [initialTaskId]);

  const pollExistingTask = async (taskId: string) => {
    setIsProcessing(true);
    setProcessingStage('reading');
    setProgressPercent(30);

    const interval = setInterval(async () => {
      try {
        const pollRes = await pollResult(taskId);
        if (pollRes.stage === 'ocr' || pollRes.stage === 'preprocessing') {
          setProcessingStage('reading');
          setProgressPercent(45);
        } else if (pollRes.stage === 'extraction') {
          setProcessingStage('structuring');
          setProgressPercent(75);
        } else if (pollRes.stage === 'validation') {
          setProcessingStage('checking');
          setProgressPercent(90);
        }

        if (pollRes.status === 'done' && pollRes.result) {
          clearInterval(interval);
          setRecord(pollRes.result);
          setProcessingStage('done');
          setProgressPercent(Math.round((pollRes.result.ocr_confidence || 0.85) * 100));
          setIsProcessing(false);
        } else if (pollRes.status === 'failed') {
          clearInterval(interval);
          setIsProcessing(false);
          setProcessingStage('idle');
          setError(pollRes.error || 'Extraction failed');
        }
      } catch (err) {
        clearInterval(interval);
        setIsProcessing(false);
        setProcessingStage('idle');
        setError(err instanceof Error ? err.message : 'Polling failed');
      }
    }, 1500);
  };

  // Process chosen file
  const handleFile = (file: File) => {
    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setError(null);
    setProcessingStage('idle');
    setProgressPercent(0);
    setRecord(EMPTY_RESULT);
  };

  // Handle file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleFile(file);
    } else {
      setError('Please drop an image file (JPEG, PNG, WEBP).');
    }
  };

  // Trigger file picker
  const handleChoosePhoto = () => {
    fileInputRef.current?.click();
  };

  // Quick load sample prescription
  const handleLoadSample = async () => {
    try {
      const res = await fetch('/sample_prescription.jpeg');
      const blob = await res.blob();
      const file = new File([blob], 'test_prescription.jpeg', { type: 'image/jpeg' });
      handleFile(file);
    } catch {
      setError('Sample prescription image not found in public folder.');
    }
  };

  // Remove current photo
  const handleRemovePhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFile(null);
    setPreviewUrl(null);
    setRecord(EMPTY_RESULT);
    setProcessingStage('idle');
    setProgressPercent(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Execute processing via Backend API
  const handleReadPrescription = async () => {
    if (!selectedFile && !previewUrl) {
      handleChoosePhoto();
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProcessingStage('reading');
    setProgressPercent(30);

    try {
      if (!selectedFile) {
        throw new Error('No image file selected.');
      }

      // Step 1: Upload to backend
      const uploadRes = await uploadPrescription(selectedFile);
      const taskId = uploadRes.task_id;

      setProcessingStage('structuring');
      setProgressPercent(60);

      // Step 2: Poll for completion
      const pollStartTime = Date.now();
      const interval = setInterval(async () => {
        try {
          const pollRes = await pollResult(taskId);

          if (pollRes.stage === 'ocr' || pollRes.stage === 'preprocessing') {
            setProcessingStage('reading');
            setProgressPercent(45);
          } else if (pollRes.stage === 'extraction') {
            setProcessingStage('structuring');
            setProgressPercent(75);
          } else if (pollRes.stage === 'validation') {
            setProcessingStage('checking');
            setProgressPercent(90);
          }

          if (pollRes.status === 'done' && pollRes.result) {
            clearInterval(interval);
            setRecord(pollRes.result);
            setProcessingStage('done');
            setProgressPercent(Math.round((pollRes.result.ocr_confidence || 0.85) * 100));
            setIsProcessing(false);
          } else if (pollRes.status === 'failed') {
            clearInterval(interval);
            throw new Error(pollRes.error || 'Extraction failed');
          } else if (Date.now() - pollStartTime > 60000) {
            clearInterval(interval);
            throw new Error('Processing timed out after 60 seconds');
          }
        } catch (pollErr) {
          clearInterval(interval);
          setIsProcessing(false);
          setProcessingStage('idle');
          setError(pollErr instanceof Error ? pollErr.message : 'Processing failed');
        }
      }, 1500);

    } catch (err) {
      console.error('Processing error:', err);
      setIsProcessing(false);
      setProcessingStage('idle');
      setError(err instanceof Error ? err.message : 'Backend connection failed. Make sure backend is running on port 8000.');
    }
  };

  // Medicine row editing
  const handleUpdateMedicine = (index: number, field: keyof MedicineItem, value: any) => {
    const updated = [...record.medicines];
    updated[index] = { ...updated[index], [field]: value };
    setRecord({ ...record, medicines: updated });
  };

  // Delete medicine row
  const handleDeleteMedicine = (index: number) => {
    const updated = record.medicines.filter((_, idx) => idx !== index);
    setRecord({ ...record, medicines: updated });
  };

  // Add new medicine row
  const handleAddMedicine = () => {
    const newMed: MedicineItem = {
      name: 'New Medicine',
      dosage: '1 tab',
      frequency: 'OD',
      duration: '5 days',
      instructions: null,
      confidence: 1.0,
      fda_verified: true,
      india_db_verified: true,
      status: 'matched',
      generic: null,
      candidates: [],
    };
    setRecord({ ...record, medicines: [...record.medicines, newMed] });
  };

  // Copy Clinical Summary for EHR / EMR
  const handleCopyClinicalSummary = () => {
    const lines = [
      '--- PRISM CLINICAL PRESCRIPTION SUMMARY ---',
      'Prescription Recognition & Intelligent Safety for Medication',
      `Patient: ${record.patient_name || 'N/A'}`,
      `Date: ${record.date || 'N/A'}`,
      `Doctor: ${record.doctor_name || 'N/A'} (Reg: ${record.doctor_reg_no || 'N/A'})`,
      `Follow-up: ${record.followup_date || 'N/A'}`,
      '',
      'MEDICATIONS:',
      ...record.medicines.map((m, idx) => 
        `${idx + 1}. ${m.name}${m.generic ? ` (${m.generic})` : ''} | ${m.dosage || 'Standard dose'} | ${m.frequency || m.duration || 'As directed'} | Instructions: ${m.instructions || 'None'}`
      ),
      '',
      `General Advice: ${record.general_instructions || 'None'}`,
      '------------------------------------'
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setIsSummaryCopied(true);
    setTimeout(() => setIsSummaryCopied(false), 2000);
  };

  // Export CSV
  const handleExportCsv = () => {
    if (!record.medicines || record.medicines.length === 0) return;
    const header = ['Medicine', 'Dosage', 'Frequency', 'Duration', 'Confidence', 'Status', 'Generic_Composition', 'FDA_Verified', 'IndiaDB_Verified'];
    const rows = record.medicines.map((m) => [
      `"${m.name.replace(/"/g, '""')}"`,
      `"${(m.dosage || '').replace(/"/g, '""')}"`,
      `"${(m.frequency || '').replace(/"/g, '""')}"`,
      `"${(m.duration || '').replace(/"/g, '""')}"`,
      `${Math.round(m.confidence * 100)}%`,
      `"${m.status || 'not_found'}"`,
      `"${(m.generic || '').replace(/"/g, '""')}"`,
      m.fda_verified ? 'Yes' : 'No',
      m.india_db_verified ? 'Yes' : 'No',
    ]);
    const csvContent = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `prescription_${record.id ? record.id.slice(0, 8) : 'export'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Download PDF Record (supports modified records and saved backend IDs)
  const handleDownloadPdf = async () => {
    if (!record?.id && record.medicines.length === 0) return;
    setIsDownloadingPdf(true);
    try {
      if (record.medicines.length > 0) {
        await exportPdfFromResult(record);
      } else if (record?.id) {
        await exportPdf(record.id);
      }
    } catch (err) {
      console.error('PDF Download failed:', err);
      alert('Failed to generate PDF. Make sure backend is running.');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // Copy JSON to clipboard
  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(record, null, 2));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Helper for medicine check badge styling
  const renderDrugCheckBadge = (med: MedicineItem, idx: number) => {
    const isMatched = med.status === 'matched' || ((med.fda_verified || med.india_db_verified) && med.status !== 'confirm');
    const isConfirm = med.status === 'confirm' || (!isMatched && med.candidates && med.candidates.length > 0);

    if (isMatched) {
      return (
        <div className="flex flex-col items-end">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <Check className="w-3 h-3 text-emerald-400" />
            <span>Found</span>
          </span>
          {med.generic && (
            <span 
              className="text-[10px] text-emerald-300/80 mt-0.5 max-w-[150px] truncate text-right font-medium" 
              title={med.generic}
            >
              {med.generic}
            </span>
          )}
        </div>
      );
    } else if (isConfirm) {
      return (
        <div className="flex flex-col items-end gap-1">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span>Confirm name</span>
          </span>
          {med.candidates && med.candidates.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-end max-w-[160px]">
              {med.candidates.slice(0, 3).map((cand, cIdx) => (
                <button
                  key={cIdx}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCandidateClick(idx, cand);
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/70 hover:bg-amber-900/80 text-amber-300 border border-amber-700/50 hover:border-amber-500 transition-colors"
                  title={`Click to set name to: ${cand}`}
                >
                  {cand}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    } else {
      return (
        <div className="flex flex-col items-end">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400/90 border border-amber-500/25">
            <AlertCircle className="w-3 h-3 text-amber-400" />
            <span>Not found</span>
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5">Review required</span>
        </div>
      );
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/jpg"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* ZOOM LIGHTBOX MODAL */}
      {isZoomOpen && previewUrl && (
        <div 
          className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-4"
          onClick={() => setIsZoomOpen(false)}
        >
          {/* Controls Bar */}
          <div 
            className="flex items-center gap-4 bg-slate-900/90 border border-slate-700/80 px-4 py-2 rounded-2xl mb-4 shadow-2xl z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-xs font-medium text-slate-300">Magnification: {Math.round(zoomLevel * 100)}%</span>
            <button
              onClick={() => setZoomLevel(prev => Math.max(0.75, prev - 0.25))}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => setZoomLevel(1)}
              className="px-2 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
            >
              Reset
            </button>
            <button
              onClick={() => setZoomLevel(prev => Math.min(3, prev + 0.25))}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-slate-700" />
            <button
              onClick={() => setIsZoomOpen(false)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Zoomable Image Container */}
          <div 
            className="relative max-w-5xl max-h-[82vh] overflow-auto rounded-2xl border border-slate-800 bg-[#040814] p-4 flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Prescription Zoom Inspection"
              style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
              className="transition-transform duration-200 object-contain rounded-lg max-h-[75vh]"
            />
          </div>
        </div>
      )}

      {/* TOP HEADER */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-6 sm:pb-8 gap-4 border-b border-slate-800/60 mb-8">
        <div className="flex items-center space-x-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-400 via-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/25 ring-1 ring-white/20">
            <span className="text-white font-serif font-black text-2xl tracking-tight">P</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-white">
                PRISM
              </h1>
              <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono text-[10px] font-semibold tracking-wider">
                AI CLINICAL SUITE
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400">
              Prescription Recognition and Intelligent Safety for Medication
            </p>
          </div>
        </div>

        {/* Status indicator pills */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Read Image Pill */}
          <div className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
            processingStage === 'reading' 
              ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-500/20'
              : processingStage === 'done' || processingStage === 'structuring' || processingStage === 'checking'
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25'
              : 'bg-slate-900/80 text-slate-400 border border-slate-800'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              processingStage === 'reading' 
                ? 'bg-cyan-400 animate-ping'
                : processingStage === 'done' || processingStage === 'structuring' || processingStage === 'checking'
                ? 'bg-emerald-400' 
                : 'bg-slate-500'
            }`} />
            <span>Read image</span>
          </div>

          {/* Structure Data Pill */}
          <div className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
            processingStage === 'structuring' 
              ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-500/20'
              : processingStage === 'done' || processingStage === 'checking'
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25'
              : 'bg-slate-900/80 text-slate-400 border border-slate-800'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              processingStage === 'structuring' 
                ? 'bg-cyan-400 animate-ping'
                : processingStage === 'done' || processingStage === 'checking'
                ? 'bg-emerald-400' 
                : 'bg-slate-500'
            }`} />
            <span>Structure data</span>
          </div>

          {/* Check Medicines Pill */}
          <div className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
            processingStage === 'checking' 
              ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-500/20'
              : processingStage === 'done'
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25'
              : 'bg-slate-900/80 text-slate-400 border border-slate-800'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              processingStage === 'checking' 
                ? 'bg-cyan-400 animate-ping'
                : processingStage === 'done' 
                ? 'bg-emerald-400' 
                : 'bg-slate-500'
            }`} />
            <span>Check medicines</span>
          </div>
        </div>
      </header>

      {/* ERROR BANNER */}
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-950/40 border border-red-800/50 flex items-start space-x-3 text-red-200 text-sm">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-red-300">Notice</p>
            <p className="text-xs text-red-300/80 mt-0.5">{error}</p>
          </div>
          <button 
            onClick={() => setError(null)}
            className="text-xs text-red-400 hover:text-red-200 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* MAIN TWO-COLUMN WORKBENCH */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7">
        
        {/* LEFT COLUMN: PRESCRIPTION PHOTO */}
        <section className="lg:col-span-5 flex flex-col rounded-2xl bg-[#091024]/90 border border-[#16274a] p-6 shadow-2xl backdrop-blur-md">
          {/* Panel Top Header */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-white tracking-wide">
              Prescription photo
            </h2>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800/90 text-slate-300 border border-slate-700/60 font-mono">
                {selectedFile ? selectedFile.name : previewUrl ? '1 file' : 'No file'}
              </span>
            </div>
          </div>

          {/* Document Preview / Upload Area */}
          <div 
            onClick={handleChoosePhoto}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative flex-1 min-h-[380px] rounded-xl border transition-all overflow-hidden flex items-center justify-center cursor-pointer group ${
              isDragging 
                ? 'border-cyan-400 bg-cyan-950/20' 
                : previewUrl 
                ? 'bg-[#050a17]/95 border-slate-800/80 hover:border-cyan-500/40 p-4' 
                : 'bg-[#060c1c]/70 border-dashed border-slate-700/80 hover:border-cyan-500/50 hover:bg-[#081228]/80 p-6'
            }`}
          >
            {previewUrl ? (
              /* REAL IMAGE PREVIEW (No fake mock letterhead) */
              <div className="relative w-full h-full min-h-[340px] flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Uploaded Prescription"
                  className="max-h-[340px] w-auto max-w-full object-contain rounded-lg shadow-2xl filter contrast-[1.03]"
                />

                {/* Top Corner Action Controls */}
                <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsZoomOpen(true);
                    }}
                    className="p-1.5 rounded-lg bg-slate-900/90 text-slate-300 hover:text-cyan-300 hover:bg-slate-800 border border-slate-700/80 shadow-md transition-all"
                    title="Zoom & Inspect handwriting"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="p-1.5 rounded-lg bg-slate-900/90 text-slate-400 hover:text-red-400 hover:bg-slate-800 border border-slate-700/80 shadow-md transition-all"
                    title="Remove image"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Hover overlay hint */}
                <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                  <span className="px-4 py-2 rounded-xl bg-slate-900/95 text-cyan-300 text-xs font-semibold border border-cyan-500/30 flex items-center gap-2 shadow-xl">
                    <Upload className="w-4 h-4 text-cyan-400" /> Click to change image
                  </span>
                </div>
              </div>
            ) : (
              /* EMPTY DROPZONE */
              <div className="flex flex-col items-center justify-center text-center p-6 space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform duration-300 shadow-inner">
                  <Upload className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-200 mb-1">
                    Upload prescription photo
                  </h3>
                  <p className="text-xs text-slate-400 max-w-xs">
                    Click to browse or drag and drop a doctor&apos;s handwritten prescription
                  </p>
                </div>

                {/* Quick Sample Button */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLoadSample();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-400 hover:text-cyan-300 border border-cyan-800/60 text-xs font-medium transition-all"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>⚡ Try sample prescription</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono pt-1">
                  <span>JPEG</span>
                  <span>•</span>
                  <span>PNG</span>
                  <span>•</span>
                  <span>WEBP</span>
                  <span>•</span>
                  <span>Max 10MB</span>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-5">
            <button
              type="button"
              onClick={handleChoosePhoto}
              className="w-full py-3 px-4 rounded-xl text-sm font-medium text-slate-200 bg-[#0d162d] hover:bg-[#132042] border border-slate-700/60 hover:border-slate-600 transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <Upload className="w-4 h-4 text-slate-400" />
              <span>{previewUrl ? 'Choose another photo' : 'Select photo'}</span>
            </button>

            <button
              type="button"
              onClick={handleReadPrescription}
              disabled={isProcessing}
              className="w-full py-3 px-5 rounded-xl text-sm font-bold text-slate-950 bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 hover:from-teal-300 hover:to-cyan-300 disabled:opacity-60 transition-all duration-200 shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                  <span>Processing AI...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-slate-950" />
                  <span>Read prescription</span>
                </>
              )}
            </button>
          </div>

          {/* Quality Indicator Bar */}
          <div className="mt-5 pt-3 border-t border-slate-800/60">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
              <span>
                Image quality:{' '}
                <strong className="text-slate-200 font-semibold">
                  {progressPercent > 0 ? `${progressPercent}% (readable)` : '—'}
                </strong>
              </span>
              <span className="text-[11px] text-cyan-400 font-mono">
                TrOCR + Qwen Vision
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-800/90 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 transition-all duration-500 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: DIGITAL RECORD & REVIEW */}
        <section className="lg:col-span-7 flex flex-col rounded-2xl bg-[#091024]/90 border border-[#16274a] p-6 shadow-2xl backdrop-blur-md">
          
          {/* Header Tabs: Record vs JSON */}
          <div className="flex items-center justify-between border-b border-slate-800/70 pb-3 mb-6">
            <div className="flex items-center space-x-6">
              <button
                type="button"
                onClick={() => setActiveTab('record')}
                className={`text-sm font-semibold pb-3 -mb-3 transition-all relative ${
                  activeTab === 'record'
                    ? 'text-white border-b-2 border-cyan-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Record
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('json')}
                className={`text-sm font-semibold pb-3 -mb-3 transition-all relative ${
                  activeTab === 'json'
                    ? 'text-white border-b-2 border-cyan-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                JSON
              </button>
            </div>

            {/* Quick Actions (Copy Clinical Summary & Model Badge) */}
            <div className="flex items-center gap-3">
              {record.medicines.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyClinicalSummary}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-all"
                    title="Copy formatted summary for EHR/EMR"
                  >
                    {isSummaryCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <ClipboardCopy className="w-3.5 h-3.5 text-slate-400" />
                        <span>Copy Summary</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-all"
                    title="Export table as CSV"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-slate-400" />
                    <span>CSV</span>
                  </button>
                </div>
              )}

              <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <span className="font-mono text-[11px]">
                  {record.model_used || 'qwen/qwen3.8-27b'}
                </span>
              </div>
            </div>
          </div>

          {activeTab === 'record' ? (
            <div className="flex-1 flex flex-col justify-between">
              <div>
                {/* 2x2 METADATA INPUTS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  {/* Patient */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Patient
                    </label>
                    <input
                      type="text"
                      value={record.patient_name || ''}
                      onChange={(e) => setRecord({ ...record, patient_name: e.target.value })}
                      placeholder="Patient name"
                      className="w-full bg-[#060b18] border border-slate-800/90 focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/40 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 transition-all font-medium"
                    />
                  </div>

                  {/* Date */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Date
                    </label>
                    <input
                      type="text"
                      value={record.date || ''}
                      onChange={(e) => setRecord({ ...record, date: e.target.value })}
                      placeholder="YYYY-MM-DD or DD/MM/YY"
                      className="w-full bg-[#060b18] border border-slate-800/90 focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/40 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 transition-all font-medium font-mono"
                    />
                  </div>

                  {/* Doctor */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Doctor
                    </label>
                    <input
                      type="text"
                      value={record.doctor_name || ''}
                      onChange={(e) => setRecord({ ...record, doctor_name: e.target.value })}
                      placeholder="Doctor name"
                      className="w-full bg-[#060b18] border border-slate-800/90 focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/40 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 transition-all font-medium"
                    />
                  </div>

                  {/* Follow-up */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Follow-up
                    </label>
                    <input
                      type="text"
                      value={record.followup_date || ''}
                      onChange={(e) => setRecord({ ...record, followup_date: e.target.value })}
                      placeholder="e.g. After 5 days"
                      className="w-full bg-[#060b18] border border-slate-800/90 focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/40 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 transition-all font-medium"
                    />
                  </div>
                </div>

                {/* CLINICAL SAFETY INTELLIGENCE BANNER */}
                {safetyAlerts.length > 0 && (
                  <div className="rounded-xl border border-sky-500/30 bg-sky-950/30 p-3.5 text-xs text-sky-200 leading-relaxed mb-4 flex items-start space-x-2.5 shadow-sm">
                    <ShieldAlert className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <span className="font-semibold text-cyan-300">Clinical Safety Intelligence:</span>
                      <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                        {safetyAlerts.map((alert, i) => (
                          <li key={i}>{alert}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* MEDICINE TABLE WITH INLINE EDIT & ROW MANAGEMENT */}
                <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-[#050a17]/90 mb-3">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        <th className="py-3 px-4">Medicine</th>
                        <th className="py-3 px-3">Strength</th>
                        <th className="py-3 px-3">Course</th>
                        <th className="py-3 px-3 text-center">Read confidence</th>
                        <th className="py-3 px-4 text-right">Drug check</th>
                        <th className="py-3 px-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-sm">
                      {record.medicines && record.medicines.length > 0 ? (
                        record.medicines.map((med, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/25 transition-colors group">
                            {/* Medicine Name (Editable) */}
                            <td className="py-2.5 px-4 font-semibold text-white">
                              <input
                                type="text"
                                value={med.name}
                                onChange={(e) => handleUpdateMedicine(idx, 'name', e.target.value)}
                                className="bg-transparent border-0 focus:ring-1 focus:ring-cyan-500 rounded px-1.5 py-0.5 w-full text-white font-semibold text-sm outline-none"
                              />
                              {med.generic && (
                                <div className="text-[11px] text-cyan-300/90 font-mono mt-0.5 px-1.5 flex items-center gap-1.5">
                                  <span className="text-[9px] uppercase px-1 py-0.2 rounded bg-cyan-950/90 border border-cyan-800/60 text-cyan-300 font-sans font-semibold">
                                    Generic
                                  </span>
                                  <span className="truncate max-w-[240px]" title={med.generic}>
                                    {med.generic}
                                  </span>
                                </div>
                              )}
                              {med.manufacturer && (
                                <div className="text-[10px] text-slate-500 px-1.5 truncate max-w-[240px]" title={med.manufacturer}>
                                  {med.manufacturer}
                                </div>
                              )}
                            </td>

                            {/* Strength (Editable) */}
                            <td className="py-2.5 px-3 text-slate-300 text-xs">
                              <input
                                type="text"
                                value={med.dosage || ''}
                                onChange={(e) => handleUpdateMedicine(idx, 'dosage', e.target.value)}
                                placeholder="—"
                                className="bg-transparent border-0 focus:ring-1 focus:ring-cyan-500 rounded px-1.5 py-0.5 w-full text-slate-300 text-xs outline-none"
                              />
                            </td>

                            {/* Course / Frequency (Editable) */}
                            <td className="py-2.5 px-3 text-slate-300 text-xs">
                              <input
                                type="text"
                                value={med.duration || med.frequency || ''}
                                onChange={(e) => handleUpdateMedicine(idx, 'duration', e.target.value)}
                                placeholder="—"
                                className="bg-transparent border-0 focus:ring-1 focus:ring-cyan-500 rounded px-1.5 py-0.5 w-full text-slate-300 text-xs outline-none"
                              />
                            </td>

                            {/* Read Confidence */}
                            <td className="py-2.5 px-3 text-center text-xs font-mono text-slate-300">
                              {Math.round((med.confidence || 0.8) * 100)}%
                            </td>

                            {/* Drug Check Pill */}
                            <td className="py-2.5 px-4 text-right">
                              {renderDrugCheckBadge(med, idx)}
                            </td>

                            {/* Delete Row Action */}
                            <td className="py-2.5 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleDeleteMedicine(idx)}
                                className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 transition-opacity"
                                title="Remove medicine"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="py-10 text-center text-slate-400 text-sm">
                            <div className="flex flex-col items-center justify-center space-y-2">
                              <FileSpreadsheet className="w-7 h-7 text-slate-600" />
                              <p className="font-medium text-slate-300">No medicines extracted yet</p>
                              <p className="text-xs text-slate-500 max-w-sm">
                                Select a prescription photo on the left and click &quot;Read prescription&quot; to begin AI digitization.
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* + Add Medicine Button */}
                <div className="flex items-center justify-between mb-5 px-1">
                  <button
                    type="button"
                    onClick={handleAddMedicine}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add medicine manually</span>
                  </button>
                  <span className="text-[11px] text-slate-500">
                    Click any cell to edit medicine details
                  </span>
                </div>

                {/* HUMAN REVIEW WARNING BOX */}
                {itemsNeedingReview.length > 0 && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.04] p-4 text-xs text-slate-300 leading-relaxed mb-6 flex items-start justify-between gap-4">
                    <div className="flex items-start space-x-3">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">
                        !
                      </div>
                      <div>
                        <strong className="text-white font-semibold">
                          {itemsNeedingReview.length} {itemsNeedingReview.length === 1 ? 'item needs' : 'items need'} a human look.
                        </strong>{' '}
                        Low-confidence readings are flagged instead of saved silently. Confirm them against the photo before use.
                      </div>
                    </div>

                    {/* Sensitivity selector */}
                    <div className="flex items-center gap-1.5 flex-shrink-0 text-[11px] text-slate-400 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-700/60">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Sensitivity:</span>
                      <select
                        value={confidenceThreshold}
                        onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                        className="bg-transparent text-cyan-300 font-semibold outline-none cursor-pointer"
                      >
                        <option value={0.70} className="bg-slate-900 text-slate-200">70%</option>
                        <option value={0.80} className="bg-slate-900 text-slate-200">80%</option>
                        <option value={0.85} className="bg-slate-900 text-slate-200">85%</option>
                        <option value={0.90} className="bg-slate-900 text-slate-200">90%</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* BOTTOM ACTION BAR */}
              <div className="pt-4 border-t border-slate-800/70 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center space-x-3.5">
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    disabled={isDownloadingPdf || (!record?.id && record.medicines.length === 0)}
                    className="py-2.5 px-4 rounded-xl text-sm font-semibold text-slate-950 bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 disabled:opacity-40 transition-all flex items-center space-x-2 shadow-md shadow-cyan-500/20 active:scale-95"
                  >
                    {isDownloadingPdf ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    <span>Download PDF record</span>
                  </button>

                  <span className="text-xs font-mono text-slate-400">
                    {record?.id ? `prism-${record.id.slice(0, 8)}.pdf` : 'prism-digital-record.pdf'}
                  </span>
                </div>

                <div className="text-xs text-slate-400 font-mono flex items-center gap-1.5 ml-auto">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  <span>
                    {record.processing_time_ms > 0 
                      ? `Processed in ${(record.processing_time_ms / 1000).toFixed(1)} s`
                      : 'Ready to process'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* JSON TAB VIEW */
            <div className="flex-1 flex flex-col justify-between">
              <div className="relative">
                <div className="flex items-center justify-between pb-2 mb-2">
                  <span className="text-xs text-slate-400 font-mono">
                    ExtractionResult payload (Schema v1.2)
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyJson}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-all"
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                        <span>Copy JSON</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="bg-[#050914] p-4 rounded-xl border border-slate-800/80 font-mono text-xs text-cyan-300 overflow-x-auto max-h-[440px] scrollbar-thin">
                  {JSON.stringify(record, null, 2)}
                </pre>
              </div>

              {/* JSON Footer */}
              <div className="pt-4 border-t border-slate-800/70 flex items-center justify-between text-xs text-slate-400">
                <span>Model: {record.model_used || 'qwen/qwen3.8-27b'}</span>
                <span>Latency: {record.processing_time_ms} ms</span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
