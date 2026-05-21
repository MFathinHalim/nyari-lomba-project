import { ExternalLink, Share2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Competition } from "../types";

interface CompetitionCardProps {
  competition: Competition;
  onShare?: () => void; // Hanya butuh callback share saja
}

export function CompetitionCard({ competition, onShare }: CompetitionCardProps) {
  const navigate = useNavigate();

  const handleCardClick = () => {
    navigate(`/competition/${competition.id}`, { state: { competition } });
  };

  return (
    <div 
      onClick={handleCardClick}
      className="bg-white border-2 border-zinc-900 p-6 flex flex-col justify-between group cursor-pointer hover:bg-zinc-900 transition-colors h-full w-full max-w-md mx-auto sm:max-w-none relative"
    >
      <div>
        {/* Status Badge & Source */}
        <div className="flex justify-between items-center mb-4 gap-4">
          {competition.isUpcoming ? (
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-black uppercase border border-blue-200">Upcoming</span>
          ) : (
            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-black uppercase border border-green-200">Open Now</span>
          )}
          <span className="text-[10px] font-bold text-zinc-400 group-hover:text-zinc-500 uppercase">
            {competition.source}
          </span>
        </div>

        {/* Poster Lomba */}
        {competition.imageUrl && (
          <div className="w-full mb-4 border-2 aspect-3/4 border-zinc-900 overflow-hidden bg-zinc-100 transition-shadow">
            <img 
              src={competition.imageUrl} 
              alt={competition.title}
              loading="lazy"
              className="w-full h-full object-cover transition-all duration-300 scale-100 group-hover:scale-105"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
        )}

        <h3 className="text-2xl font-black leading-tight mb-2 group-hover:text-white line-clamp-2">
          {competition.title}
        </h3>
        <p className="text-sm text-zinc-500 group-hover:text-zinc-400 line-clamp-2 italic mb-3">
          {competition.shortDescription}
        </p>
      </div>

      <div className="mt-auto">
        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-4">
          {competition.tags.map(tag => (
            <span key={tag} className="px-2 py-1 border border-zinc-200 group-hover:border-zinc-700 text-zinc-500 group-hover:text-zinc-400 text-[10px] font-black uppercase rounded">
              {tag}
            </span>
          ))}
        </div>

        {/* Category & Deadline */}
        <div className="flex justify-between items-end mb-6">
          <div className="flex flex-col flex-1 truncate pr-2">
            <span className="text-[10px] font-black text-zinc-400 uppercase">Category</span>
            <span className="font-black text-lg group-hover:text-white leading-tight truncate">{competition.category}</span>
          </div>
          <div className="text-right shrink-0">
             <span className="text-[10px] font-black text-zinc-400 uppercase">Deadline</span>
             <div className="text-sm font-bold text-zinc-900 group-hover:text-zinc-300">{competition.deadline}</div>
          </div>
        </div>

        {/* Actions Button */}
        <div className="flex items-center gap-3 w-full">
          {/* CTA Button */}
          <a 
            href={competition.url} 
            target="_blank" 
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex-1 flex items-center justify-center py-3 bg-[#21a701] hover:bg-blue-700 border-2 border-zinc-900 text-white font-black uppercase text-xs transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] group-hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] focus:outline-none"
          >
            View Details
            <ExternalLink className="w-3 h-3 ml-2" />
          </a>

          {/* Share Button (Sekarang terbuka untuk semua pengunjung web) */}
          <button 
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShare?.();
            }}
            className="w-11 h-11 shrink-0 cursor-pointer rounded border-2 border-zinc-900 bg-white flex items-center justify-center transition hover:bg-zinc-100 group-hover:bg-zinc-800 group-hover:border-zinc-700 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] group-hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)]"
          >
            <Share2 className="w-4 h-4 text-zinc-900 group-hover:text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}