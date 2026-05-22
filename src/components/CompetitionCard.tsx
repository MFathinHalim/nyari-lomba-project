import { ExternalLink, Share2, Bookmark } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Competition } from "../types";

interface CompetitionCardProps {
  competition: Competition;
  onShare?: () => void;
  isSaved?: boolean;          // Mengontrol warna icon bookmark (aktif/tidak)
  onSave?: () => void;         // Handler fungsi ketika tombol bookmark diklik
}

export function CompetitionCard({ competition, onShare, isSaved = false, onSave }: CompetitionCardProps) {
  const navigate = useNavigate();

  const handleCardClick = () => {
    navigate(`/competition/${competition.id}`, { state: { competition } });
  };

  const getDaysLeft = (deadlineStr?: string) => {
    if (!deadlineStr) return null;
    
    const monthMap: { [key: string]: number } = {
      jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5,
      jul: 6, agu: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11
    };

    const parts = deadlineStr.trim().split(/\s+/);
    if (parts.length !== 3) return null;

    const day = parseInt(parts[0], 10);
    const monthIndex = monthMap[parts[1].toLowerCase()];
    const year = parseInt(parts[2], 10);

    if (monthIndex === undefined || isNaN(day) || isNaN(year)) return null;

    const targetDate = new Date(year, monthIndex, day).getTime();
    const diffTime = targetDate - Date.now();
    
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const daysLeft = getDaysLeft(competition.deadline);

  return (
    <div 
      onClick={handleCardClick}
      className="bg-white border-2 border-zinc-900 p-6 flex flex-col justify-between group cursor-pointer hover:bg-zinc-900 transition-colors h-full w-full max-w-md mx-auto sm:max-w-none relative"
    >
      {/* Badge Urgensi Deadline */}
      {daysLeft !== null && daysLeft <= 3 && daysLeft > 0 && (
        <div className="absolute -top-3 -right-2 bg-red-500 text-white border-2 border-black text-[10px] font-black px-2 py-1 uppercase tracking-wider rotate-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] z-20">
          DEADLINE H-{daysLeft} !
        </div>
      )}

      {/* --- TOMBOL SAVE / BOOKMARK NEOBRUTALISM --- */}
      {onSave && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation(); // Mencegah navigasi ke halaman detail saat klik save
            onSave();
          }}
          className={`absolute top-14 right-4 w-10 h-10 border-2 border-zinc-900 flex items-center justify-center transition-all cursor-pointer z-20 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group-hover:border-white group-hover:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] ${
            isSaved 
              ? 'bg-amber-300 text-black' 
              : 'bg-white text-zinc-400 hover:text-zinc-900 group-hover:bg-zinc-800 group-hover:text-zinc-300'
          }`}
        >
          <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-black stroke-[2.5]' : 'stroke-[2.5]'}`} />
        </button>
      )}

      <div>
        {/* Status Badge & Source */}
        <div className="flex justify-between items-center mb-4 gap-4">
          {competition.isUpcoming ? (
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-black uppercase border border-blue-200">Upcoming</span>
          ) : (
            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-black uppercase border border-green-200">Open Now</span>
          )}
          <span className="text-[10px] font-bold text-zinc-400 group-hover:text-zinc-500 uppercase pr-10">
            sc: {competition.source}
          </span>
        </div>

        {/* Poster Lomba */}
        {competition.imageUrl && (
          <div className="w-full mb-4 border-2 aspect-[3/4] border-zinc-900 overflow-hidden bg-zinc-100 transition-shadow group-hover:border-white">
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

        <h3 className="text-2xl font-black leading-tight mb-2 group-hover:text-white line-clamp-1">
          {competition.title}
        </h3>
        <p className="text-sm text-zinc-500 group-hover:text-zinc-400 line-clamp-2 italic mb-3">
          {competition.shortDescription}
        </p>
      </div>

      <div className="mt-auto">
        {/* Tags */}
        <div className="flex overflow-x-auto gap-2 mb-2 hide-scrollbar pb-1 -mx-1 px-1 snap-x">
          {competition.tags.map(tag => (
            <span 
              key={tag} 
              className="shrink-0 snap-start px-2 py-1 border border-zinc-200 group-hover:border-zinc-700 text-zinc-500 group-hover:text-zinc-400 text-[10px] font-black uppercase rounded"
            >
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
            className="flex-1 flex items-center justify-center py-3 bg-[#21a701] hover:bg-blue-700 border-2 border-zinc-900 text-white font-black uppercase text-xs transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] group-hover:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] group-hover:border-white focus:outline-none"
          >
            View Details
            <ExternalLink className="w-3 h-3 ml-2" />
          </a>

          {/* Share Button */}
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