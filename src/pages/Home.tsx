import React, { useState, useEffect, useRef, useMemo } from "react"; 
import { Link } from "react-router-dom";
import { Loader2, Info, Volume2, VolumeX, User, ChevronLeft, ChevronRight, Trophy, Flame, Sparkles } from "lucide-react";
import { CompetitionCard } from "../components/CompetitionCard";
import { Competition } from "../types";
import { auth, logInWithGoogle, logOut, subscribeToUserDoc, toggleSaveCompetition } from "../lib/firebase"; 
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";

export default function Home() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(false);
  const [puspresnasLoading, setPuspresnasLoading] = useState(false); // State khusus background pusher
  const [error, setError] = useState("");
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [savedCompetitions, setSavedCompetitions] = useState<Competition[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [isUpcomingOnly, setIsUpcomingOnly] = useState(false);
  const [isUrgentFirst, setIsUrgentFirst] = useState(false);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 9;

  // Listen Auth State
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribeAuth();
  }, []);

  // Listen data bookmark user
  useEffect(() => {
    if (!user) {
      setSavedCompetitions([]);
      return;
    }
    const unsubscribe = subscribeToUserDoc(user.uid, (userData) => {
      if (userData && userData.sharedCompetitions) {
        setSavedCompetitions(userData.sharedCompetitions);
      } else {
        setSavedCompetitions([]);
      }
    });
    return () => unsubscribe();
  }, [user]);

  const savedIds = useMemo(() => {
    return savedCompetitions.map(comp => comp.id);
  }, [savedCompetitions]);

  const handleSaveToggle = async (competition: Competition) => {
    if (!user) {
      alert("Login dulu bro, biar bisa nge-save tantangan! 😎");
      return;
    }
    const isSaved = savedIds.includes(competition.id);
    try {
      await toggleSaveCompetition(user.uid, competition, isSaved);
    } catch (err) {
      alert("Gagal menyinkronkan data simpanan ke cloud!");
    }
  };

  const handleShare = async (competition: Competition) => {
    const shareUrl = `${window.location.origin}/competition/${competition.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: competition.title, url: shareUrl });
      } catch (err) {
        console.log("Share dibatalkan:", err);
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

  const parseCustomDate = (dateStr?: string): number => {
    if (!dateStr) return Infinity;
    const monthMap: { [key: string]: number } = {
      jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5,
      jul: 6, agu: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11
    };
    const parts = dateStr.trim().split(/\s+/);
    if (parts.length !== 3) return Infinity;

    const day = parseInt(parts[0], 10);
    const monthName = parts[1].toLowerCase();
    const year = parseInt(parts[2], 10);
    const monthIndex = monthMap[monthName];

    if (monthIndex !== undefined && !isNaN(day) && !isNaN(year)) {
      return new Date(year, monthIndex, day).getTime();
    }
    const fallback = new Date(dateStr).getTime();
    return isNaN(fallback) ? Infinity : fallback;
  };

  // LOGIKA UTAMA: Ambil data cepat, panggil data lambat di background, lalu gabung otomatis!
  async function fetchAllDataStream() {
    setLoading(true);
    setError("");
    
    const fastUrl = new URL("/api/competitions", window.location.href);
    const puspresnasUrl = new URL("/api/competitions/puspresnas", window.location.href);
    
    if (searchQuery.trim()) {
      fastUrl.searchParams.append("q", searchQuery);
      puspresnasUrl.searchParams.append("q", searchQuery);
    }
    if (category !== "all") {
      fastUrl.searchParams.append("category", category);
      puspresnasUrl.searchParams.append("category", category);
    }

    // Step 1: Panggil & Tampilkan Data Cepat Terlebih Dahulu
    try {
      const res = await fetch(fastUrl);
      if (!res.ok) throw new Error("Gagal memuat kompetisi standar.");
      const fastData = await res.json();
      setCompetitions(fastData); 
    } catch (err: any) {
      setError(err.message || "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }

    // Step 2: Jalankan Stream Puspresnas di Background Secara Asinkronus
    setPuspresnasLoading(true);
    try {
      const pRes = await fetch(puspresnasUrl);
      if (pRes.ok) {
        const puspresnasData = await pRes.json();
        // Sisipkan data Puspresnas di posisi paling atas array utama
        setCompetitions(prev => [...puspresnasData, ...prev]);
      }
    } catch (pErr) {
      console.error("Gagal memuat data latar belakang Puspresnas:", pErr);
    } finally {
      setPuspresnasLoading(false);
    }
  }

  useEffect(() => {
    fetchAllDataStream();
  }, []);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCurrentPage(1); 
    fetchAllDataStream();
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [isUpcomingOnly, isUrgentFirst]);

  const displayedCompetitions = useMemo(() => {
    let result = competitions.filter(comp => {
      if (isUpcomingOnly && !comp.isUpcoming) return false;
      return true;
    });

    if (isUrgentFirst) {
      const now = Date.now();
      result = [...result].sort((a, b) => {
        const timeA = parseCustomDate(a.deadline);
        const timeB = parseCustomDate(b.deadline);
        const isPastA = timeA < now;
        const isPastB = timeB < now;
        if (isPastA && !isPastB) return 1;
        if (!isPastA && isPastB) return -1;
        return timeA - timeB;
      });
    }
    return result;
  }, [competitions, isUpcomingOnly, isUrgentFirst]);

  const { paginatedCompetitions, totalPages } = useMemo(() => {
    const total = Math.ceil(displayedCompetitions.length / itemsPerPage);
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const paginated = displayedCompetitions.slice(indexOfFirstItem, indexOfLastItem);
    
    return { paginatedCompetitions: paginated, totalPages: total };
  }, [displayedCompetitions, currentPage, itemsPerPage]);

  return (
    <>
      <div className="fixed inset-0 bg-[url('https://c4.wallpaperflare.com/wallpaper/441/80/973/business-compete-competition-competitive-wallpaper-preview.jpg')] bg-no-repeat bg-cover bg-center z-0 pointer-events-none transform-gpu" />
      <div className="fixed inset-0 bg-white/85 z-0 pointer-events-none" />

      {/* Marquee */}
      <div className="relative z-20 w-full bg-zinc-900 text-white h-8 border-b-2 border-zinc-900 overflow-hidden flex items-center text-xs font-black select-none uppercase tracking-widest">
        <div className="flex w-max relative">
          <div className="animate-marquee whitespace-nowrap flex gap-8 items-center pr-8">
            <span>REBUT HADIAH TOTAL RATUSAN JUTA RUPIAH</span>
            <span>•</span>
            <span>GAK USAH CUPU, IKUT LOMBA BIAR ADA VALUE</span>
            <span>•</span>
            <span>JANGAN CUMA REBAHAN DOANG GUYSSS</span>
            <span>•</span>
            <span>KATA WAGURI DIA SUKA COWOK AMBIS</span>
            <span>•</span>
          </div>
          <div className="animate-marquee2 absolute top-0 left-full whitespace-nowrap flex gap-8 items-center pr-8">
            <span>REBUT HADIAH TOTAL RATUSAN JUTA RUPIAH</span>
            <span>•</span>
            <span>GAK USAH CUPU, IKUT LOMBA BIAR ADA VALUE</span>
            <span>•</span>
            <span>JANGAN CUMA REBAHAN DOANG GUYSSS</span>
            <span>•</span>
            <span>KATA WAGURI DIA SUKA COWOK AMBIS</span>
            <span>•</span>
          </div>
        </div>
      </div>
      
      <div className="relative min-h-screen font-sans text-zinc-900 flex flex-col z-10">
        {/* Navbar */}
        <nav className="h-20 border-b-2 border-zinc-900 flex items-center justify-between px-6 sm:px-10 bg-white sticky top-0 z-20 w-full">
          <div className="text-3xl font-black text-[#032583] tracking-tighter hover:scale-105 transition-transform cursor-pointer">
            NANTANGIN<span className="text-red-500">.</span>
          </div>
          <div className="flex items-center gap-4 sm:gap-8 font-bold text-sm tracking-wide uppercase">
            <button onClick={toggleAudio} className={`w-10 h-10 border-2 border-zinc-900 bg-white flex items-center justify-center text-zinc-900 transition ${!isPlaying ? 'shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]' : ''} hover:bg-zinc-100 focus:outline-none shrink-0 cursor-pointer`}>
              {isPlaying ? <Volume2 className="w-4 h-4 animate-bounce" /> : <VolumeX className="w-4 h-4" />}
            </button>
            
            {!authLoading && (
              user ? (
                <div className="flex items-center gap-4">
                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-xs font-black">{user.displayName || "User"}</span>
                    <button onClick={handleLogout} className="text-[10px] text-zinc-500 hover:text-zinc-900 underline uppercase cursor-pointer">Log Out</button>
                  </div>
                  <Link to="/profile" className="w-10 h-10 border-2 border-zinc-900 bg-[#ff3b30] text-white flex items-center justify-center shrink-0 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all overflow-hidden">
                    {user.photoURL ? (
                       <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover border-none" referrerPolicy="no-referrer" />
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

        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-10 py-10 sm:py-16 flex flex-col justify-between">
          <div>
            {/* Hero */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12 items-start">
              <div className="lg:col-span-2 flex flex-col justify-center">
                <h1 className="text-5xl sm:text-7xl font-black leading-none tracking-tighter">
                  TEMUKAN <br/><span className="text-[#ff9006] bg-zinc-900 text-white px-4 inline-block my-2 rotate-[-1deg] shadow-[6px_6px_0px_0px_#ffce00]">TANTANGAN</span><br /> SELANJUTNYA.
                </h1>
              </div>

              <div className="grid grid-cols-2 gap-4 lg:col-span-1 w-full">
                <div className="border-2 border-zinc-900 bg-[#a3e635] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between h-28 rotate-[1deg]">
                  <Trophy className="w-6 h-6 stroke-[2.5]" />
                  <div>
                    <div className="text-2xl font-black">{competitions.length}</div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-zinc-700">Total Tantangan</div>
                  </div>
                </div>
                <div className="border-2 border-zinc-900 bg-[#ff007f] text-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between h-28 rotate-[-2deg]">
                  <Flame className="w-6 h-6 stroke-[2.5]" />
                  <div>
                    <div className="text-2xl font-black">GASSIN</div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-pink-200">Coba Aja Dulu</div>
                  </div>
                </div>
                <div className="col-span-2 border-2 border-zinc-900 bg-[#00e5ff] p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center gap-3">
                  <Sparkles className="w-6 h-6 shrink-0 animate-spin [animation-duration:6s]" />
                  <span className="text-xs font-black uppercase tracking-tight">Tersedia data dari Puspresnas juga!</span>
                </div>
              </div>
            </div>

            {/* Asynchronous Background Loader Indicator */}
            {puspresnasLoading && (
              <div className="w-full bg-[#7c3aed] text-white border-2 border-zinc-900 p-3 mb-6 flex items-center justify-between gap-3 font-black text-xs uppercase tracking-wider shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] animate-pulse">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#00e5ff]" />
                  <span>Sistem sedang merayap ke Puspresnas Kemendikdasmen RI di background...</span>
                </div>
                <span className="bg-black/30 px-2 py-0.5 text-[10px]">TUNGGU BENTAR</span>
              </div>
            )}

            {/* Form Pencarian */}
            <form onSubmit={handleSearch} className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center mt-6 mb-10">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="cari tantangan lah, biar gak cupu :)"
                  className="w-full h-14 sm:h-16 bg-white border-2 border-zinc-900 px-4 sm:px-6 font-bold text-base sm:text-lg focus:outline-none placeholder-zinc-400 text-zinc-900"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              
              <div className="flex gap-4 shrink-0 overflow-x-auto pb-4 lg:pb-0 hide-scrollbar items-center">
                <button
                  type="button"
                  onClick={() => setIsUpcomingOnly(!isUpcomingOnly)}
                  className={`h-14 sm:h-16 cursor-pointer shrink-0 flex items-center justify-center px-4 sm:px-6 border-2 border-zinc-900 font-bold text-xs sm:text-sm uppercase transition-all ${isUpcomingOnly ? 'bg-blue-300 text-black font-black shadow-none' : 'bg-white text-zinc-900 hover:bg-zinc-100'}`}
                >
                  Upcoming Only
                </button>

                <button
                  type="button"
                  onClick={() => setIsUrgentFirst(!isUrgentFirst)}
                  className={`h-14 sm:h-16 cursor-pointer shrink-0 flex items-center justify-center px-4 sm:px-6 border-2 border-zinc-900 font-black text-xs sm:text-sm uppercase transition-all ${isUrgentFirst ? 'bg-red-400 text-black shadow-none' : 'bg-white text-zinc-900 hover:bg-zinc-100'}`}
                >
                  Urgent First
                </button>

                <button
                  type="submit"
                  disabled={loading}
                  className="h-14 sm:h-16 cursor-pointer shrink-0 bg-[#ffce00] border-2 border-zinc-900 text-black px-6 sm:px-8 font-black uppercase text-xs sm:text-sm transition-all hover:bg-[#ffe055] min-w-[120px]"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "CARI!"}
                </button>
              </div>
            </form>

            {/* Loading State Utama */}
            {loading && (
              <div className="w-full bg-zinc-900 text-white border-2 border-zinc-900 p-4 mb-10 flex items-center justify-center gap-3 font-black text-sm uppercase tracking-widest shadow-[4px_4px_0px_0px_#ffce00]">
                <Loader2 className="w-5 h-5 animate-spin text-[#ffce00]" /> 
                Menyisir Event Kompetisi...
              </div>
            )}

            {error && (
              <div className="bg-red-200 text-zinc-900 border-2 border-zinc-900 p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex items-start mb-10 font-bold">
                <Info className="w-6 h-6 mr-3 shrink-0 mt-0.5 text-red-700" />
                <div>
                  <p className="text-xl font-black uppercase">Waduh, Error Gan!</p>
                  <p className="text-sm italic">{error}</p>
                </div>
              </div>
            )}

            {!loading && displayedCompetitions.length === 0 && !error && (
              <div className="bg-white border-2 border-zinc-900 p-12 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center justify-center text-center mb-10">
                <p className="font-black text-zinc-900 text-2xl uppercase tracking-tighter">Lomba Gak Ketemu, Masbro!</p>
                <p className="text-sm text-zinc-500 mt-1">Coba cari kata kunci lain.</p>
              </div>
            )}

            {/* Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 pb-10">
              {paginatedCompetitions.map((comp, index) => (
                <div key={`${comp.id}-${index}`} className="w-full flex items-stretch">
                  <CompetitionCard 
                    competition={comp} 
                    onShare={() => handleShare(comp)} 
                    isSaved={savedIds.includes(comp.id)}
                    onSave={() => handleSaveToggle(comp)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <div className="flex justify-center items-center gap-3 mt-8 pb-6">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => {
                  setCurrentPage(prev => Math.max(prev - 1, 1));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="w-12 h-12 border-2 cursor-pointer border-zinc-900 bg-white flex items-center justify-center text-zinc-900 transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-zinc-100 disabled:opacity-40 disabled:shadow-none"
              >
                <ChevronLeft className="w-5 h-5 stroke-[3]" />
              </button>

              <div className="h-12 px-6 border-2 border-zinc-900 bg-zinc-900 text-white font-black text-sm uppercase tracking-wider flex items-center justify-center shadow-[4px_4px_0px_0px_#ff9006]">
                Halaman {currentPage} / {totalPages}
              </div>

              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => {
                  setCurrentPage(prev => Math.min(prev + 1, totalPages));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="w-12 h-12 border-2 cursor-pointer border-zinc-900 bg-white flex items-center justify-center text-zinc-900 transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-zinc-100 disabled:opacity-40 disabled:shadow-none"
              >
                <ChevronRight className="w-5 h-5 stroke-[3]" />
              </button>
            </div>
          )}
        </main>
        
        <audio ref={audioRef} loop src="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" />

        <style>{`
          .hide-scrollbar::-webkit-scrollbar { display: none; }
          .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          
          @keyframes marquee {
            0% { transform: translateX(0%); }
            100% { transform: translateX(-100%); }
          }
          .animate-marquee { animation: marquee 25s linear infinite; }
          .animate-marquee2 { animation: marquee 25s linear infinite; }
        `}</style>
      </div>
    </>
  );
}