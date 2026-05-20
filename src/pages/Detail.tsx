import React, { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Calendar, Tag, Share2, Check } from "lucide-react";
import { Competition } from "../types";

export default function Detail() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const competition = state?.competition as Competition;

  if (!competition) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-8">
        <p className="text-xl font-bold uppercase mb-4">Competition not found</p>
        <button onClick={() => navigate("/")} className="px-6 py-3 bg-zinc-900 text-white font-black uppercase text-sm border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-zinc-800">
          Go Back
        </button>
      </div>
    );
  }

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: competition.title,
          text: competition.shortDescription,
          url: url,
        });
      } catch (err) {
        // Fallback to copy if share cancels or fails
        copyToClipboard(url);
      }
    } else {
      copyToClipboard(url);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 flex flex-col">
      {/* Header */}
      <nav className="h-20 border-b border-zinc-200 flex items-center px-6 sm:px-10 bg-white shrink-0 sticky top-0 z-10 w-full">
        <Link to="/" className="flex items-center gap-2 group mr-auto">
          <div className="w-10 h-10 border-2 border-zinc-900 flex items-center justify-center transition-colors group-hover:bg-zinc-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <ArrowLeft className="w-5 h-5 text-zinc-900" />
          </div>
          <span className="font-bold text-sm tracking-wide uppercase ml-2 hidden sm:block">Back</span>
        </Link>
        <div className="text-3xl font-black tracking-tighter absolute left-1/2 -translate-x-1/2">LOMBA.<span className="text-blue-600">ID</span></div>
      </nav>

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-10 py-10 sm:py-16">
        <div className="bg-white border-2 border-zinc-900 p-6 sm:p-10 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
            <div className="flex flex-col items-start gap-4 flex-1">
              {competition.isUpcoming ? (
                <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-black uppercase border-2 border-blue-200">Upcoming</span>
              ) : (
                <span className="px-3 py-1 bg-zinc-100 text-zinc-600 text-xs font-black uppercase border-2 border-zinc-200">Past</span>
              )}
              <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">{competition.title}</h1>
            </div>
            
            <button 
              onClick={handleShare}
              className="shrink-0 w-full sm:w-auto px-6 py-3 border-2 border-zinc-900 bg-zinc-50 flex items-center justify-center gap-2 font-bold uppercase text-sm hover:bg-zinc-100 transition-colors shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
            >
              {copied ? <Check className="w-5 h-5 text-green-600" /> : <Share2 className="w-5 h-5" />}
              {copied ? "Copied!" : "Share"}
            </button>
          </div>

          <p className="text-lg sm:text-xl font-medium text-zinc-600 border-l-4 border-blue-600 pl-4 py-1 my-4">
            {competition.shortDescription}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-6 border-y-2 border-zinc-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-zinc-100 border-2 border-zinc-900 flex items-center justify-center shrink-0">
                <Calendar className="w-5 h-5 text-zinc-900" />
              </div>
              <div>
                <p className="text-xs font-black text-zinc-400 uppercase">Deadline</p>
                <p className="font-bold text-lg">{competition.deadline}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-zinc-100 border-2 border-zinc-900 flex items-center justify-center shrink-0">
                <Tag className="w-5 h-5 text-zinc-900" />
              </div>
              <div>
                <p className="text-xs font-black text-zinc-400 uppercase">Category</p>
                <p className="font-bold text-lg">{competition.category}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 sm:col-span-2 mt-4">
              <p className="text-xs font-black text-zinc-400 uppercase mr-2 mt-1">Tags</p>
              <div className="flex flex-wrap gap-2">
                {competition.tags.map((tag, i) => (
                  <span key={i} className="px-2 py-1 bg-zinc-100 text-zinc-600 font-bold text-[10px] uppercase border border-zinc-200">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-6">
            <p className="text-xs font-black text-zinc-400 uppercase mb-4">Provider / Source</p>
            <p className="text-2xl font-black text-zinc-300 uppercase underline decoration-4 underline-offset-4 mb-10">{competition.source}</p>

            <a 
              href={competition.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center justify-center w-full sm:w-max px-10 py-5 bg-blue-600 hover:bg-blue-700 border-2 border-zinc-900 text-white font-black uppercase text-base sm:text-lg transition shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] focus:outline-none gap-3"
            >
              Open Registration <ExternalLink className="w-5 h-5" />
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
