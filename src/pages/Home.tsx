import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Loader2, Info, Volume2, VolumeX, User } from "lucide-react";
import { CompetitionCard } from "../components/CompetitionCard";
import { Competition } from "../types";
import { auth, logInWithGoogle, logOut } from "../lib/firebase"; // Hapus logShared dan subscribe
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";

export default function Home() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [isUpcomingOnly, setIsUpcomingOnly] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Listener Auth murni tanpa dengerin dokumen Firestore lagi
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribeAuth();
  }, []);

  // Murni Web Share API & Clipboard Fallback saja
  const handleShare = async (competition: Competition) => {
    const shareUrl = `${window.location.origin}/competition/${competition.id}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: competition.title,
          url: shareUrl,
        });
      } catch (err) {
        console.log("Share dibatalkan atau error:", err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        alert("Link kompetisi berhasil disalin ke clipboard!");
      } catch (clipErr) {
        console.error("Gagal menyalin link:", clipErr);
      }
    }
  };

  const handleLogin = async () => {
    try { await logInWithGoogle(); } catch (error) { console.error(error); }
  };

  const handleLogout = async () => {
    try { await logOut(); } catch (error) { console.error(error); }
  };

  const toggleAudio = () => {
    if (audioRef.current) {
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play().catch(e => console.error(e));
      setIsPlaying(!isPlaying);
    }
  };

  async function fetchCompetitions() {
    setLoading(true);
    setError("");
    try {
      const url = new URL("/api/competitions", window.location.href);
      if (searchQuery.trim()) url.searchParams.append("q", searchQuery);
      if (category !== "all") url.searchParams.append("category", category);

      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to search competitions");
      const data = await res.json();
      setCompetitions(data);
    } catch (err: any) {
      setError(err.message || "An error occurred.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCompetitions();
  }, []);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    fetchCompetitions();
  };

  const displayedCompetitions = competitions.filter(comp => {
    if (isUpcomingOnly && !comp.isUpcoming) return false;
    if (searchQuery && !comp.title.toLowerCase().includes(searchQuery.toLowerCase()) && !comp.shortDescription.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
<div className="relative min-h-screen bg-[url('https://c4.wallpaperflare.com/wallpaper/441/80/973/business-compete-competition-competitive-wallpaper-preview.jpg')] bg-no-repeat bg-cover bg-fixed font-sans text-zinc-900 flex flex-col">      {/* Header */}
      <div className="absolute inset-0 bg-white/70 pointer-events-none z-0"></div>
      <div className="relative z-10 flex flex-col flex-1">
      <nav className="h-20 border-b border-zinc-200 flex items-center justify-between px-6 sm:px-10 bg-white sticky top-0 z-10 w-full">
        <div className="text-3xl font-black text-[#032583] tracking-tighter">NANTANGIN</div>
        <div className="flex items-center gap-4 sm:gap-8 font-bold text-sm tracking-wide uppercase">
          <button onClick={toggleAudio} className="w-10 h-10 border-2 border-zinc-900 bg-white flex items-center justify-center text-zinc-900 transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-zinc-100 focus:outline-none shrink-0 cursor-pointer">
            {isPlaying ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          
          {!authLoading && (
            user ? (
              <div className="flex items-center gap-4">
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-xs font-black">{user.displayName || "User"}</span>
                  <button onClick={handleLogout} className="text-[10px] text-zinc-500 hover:text-zinc-900 underline uppercase cursor-pointer">Log Out</button>
                </div>
                <Link to="/profile" className="w-10 h-10 border-2 border-zinc-900 bg-zinc-900 text-white flex items-center justify-center shrink-0 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:opacity-90 transition overflow-hidden">
                  {user.photoURL ? (
                     <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover grayscale" referrerPolicy="no-referrer" />
                  ) : (
                     <User className="w-4 h-4" />
                  )}
                </Link>
              </div>
            ) : (
              <button onClick={handleLogin} className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white font-black text-xs uppercase border-2 border-zinc-900 transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] shrink-0 cursor-pointer">
                Log In
              </button>
            )
          )}
        </div>
      </nav>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-10 py-10 sm:py-16">
        <div className="flex flex-col mb-12">
          <h1 className="text-5xl sm:text-7xl font-black leading-none tracking-tighter">
            FIND YOUR<br/><span className="text-[#ff9006]">NEXT CHALLENGE.</span>
          </h1>

          <form onSubmit={handleSearch} className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center mt-10">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search business cases, essays, hackathons..."
                className="w-full h-14 sm:h-16 bg-white border-2 border-zinc-900 px-4 sm:px-6 font-bold text-base sm:text-lg focus:outline-none placeholder-zinc-400 text-zinc-900"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <div className="flex gap-4 shrink-0 overflow-x-auto pb-4 lg:pb-0 hide-scrollbar items-center">
              <button
                type="button"
                onClick={() => setIsUpcomingOnly(!isUpcomingOnly)}
                className={`h-14 sm:h-16 shrink-0 flex items-center justify-center px-4 sm:px-6 border-2 font-bold text-xs sm:text-sm uppercase transition-all ${isUpcomingOnly ? 'bg-blue-100 border-blue-600 text-blue-700' : 'bg-white border-zinc-900 text-zinc-900 hover:bg-zinc-100'}`}
              >
                Upcoming Only
              </button>

              <button
                type="submit"
                disabled={loading}
                className="h-14 sm:h-16 shrink-0 bg-[#ffce00] border-2 border-zinc-900 text-black px-6 sm:px-8 font-black uppercase text-xs sm:text-sm transition-colors flex items-center justify-center min-w-[120px]"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Search"}
              </button>
            </div>
          </form>

          {error && (
            <div className="bg-red-50 text-red-900 border-2 border-zinc-900 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-start mt-6 font-bold">
              <Info className="w-6 h-6 mr-3 shrink-0 mt-0.5 text-red-600" />
              <div>
                <p className="text-xl font-black uppercase">Failed to load</p>
                <p className="text-sm italic">{error}</p>
              </div>
            </div>
          )}

          {!loading && displayedCompetitions.length === 0 && !error && (
            <div className="bg-zinc-100 border-2 border-dashed border-zinc-400 p-10 flex flex-col items-center justify-center text-center mt-6">
              <p className="font-bold text-zinc-400 text-lg">No competitions found for this criteria.</p>
              <div className="mt-4 w-12 h-1 bg-zinc-300"></div>
            </div>
          )}
        </div>

        {/* Cards Section */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 pb-10">
          {displayedCompetitions.map((comp, index) => (
            // FIXED: Menambahkan index supaya key dijamin selalu unik
            <div key={`${comp.id}-${index}`} className="w-full flex items-stretch">
              <CompetitionCard 
                competition={comp} 
                onShare={() => handleShare(comp)} 
              />
            </div>
          ))}
        </div>
      </main>
      
      <audio ref={audioRef} loop src="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" />

      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      </div>
    </div>
  );
}