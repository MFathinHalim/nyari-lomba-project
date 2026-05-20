import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Loader2, Info, Volume2, VolumeX, User } from "lucide-react";
import { CompetitionCard } from "../components/CompetitionCard";
import { Competition } from "../types";
import { auth, logInWithGoogle, logOut, subscribeToUserDoc, toggleSavedCompetition } from "../lib/firebase";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";

export default function Home() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [isUpcomingOnly, setIsUpcomingOnly] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let unsubscribeDoc: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        unsubscribeDoc = subscribeToUserDoc(currentUser.uid, (data) => {
          setUserData(data);
        });
      } else {
        setUserData(null);
        if (unsubscribeDoc) unsubscribeDoc();
      }
      setAuthLoading(false);
    });
    return () => {
      unsubscribeAuth();
      if (unsubscribeDoc) unsubscribeDoc();
    }
  }, []);

  const handleToggleSave = async (compId: string, isSaved: boolean) => {
    if (!user) return;
    try {
      await toggleSavedCompetition(user.uid, compId, isSaved);
    } catch (err) {
      console.error("Failed to toggle save", err);
    }
  };

  const handleLogin = async () => {
    try {
      await logInWithGoogle();
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await logOut();
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  const toggleAudio = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(e => console.error("Audio playback error:", e));
      }
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
      setError(err.message || "An error occurred while fetching.");
    } finally {
      setLoading(false);
    }
  }

  // Initial fetch and fetch when pressing enter or search button
  useEffect(() => {
    fetchCompetitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    fetchCompetitions();
  };


  // Client-side filtering for upcoming toggle if backend returns both
  const displayedCompetitions = competitions.filter(comp => {
    if (isUpcomingOnly && !comp.isUpcoming) return false;
    // Also basic client-side text filtering just in case backend missed
    if (searchQuery && !comp.title.toLowerCase().includes(searchQuery.toLowerCase()) && !comp.shortDescription.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 flex flex-col">
      {/* Header */}
      <nav className="h-20 border-b border-zinc-200 flex items-center justify-between px-6 sm:px-10 bg-white sticky top-0 z-10 w-full">
        <div className="text-3xl font-black tracking-tighter">LOMBA.<span className="text-blue-600">ID</span></div>
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
        
        {/* Top Section: Intro & Form */}
        <div className="flex flex-col mb-12">
          <div className="flex flex-col gap-4">
            <h1 className="text-5xl sm:text-7xl font-black leading-none tracking-tighter">
              FIND YOUR<br/><span className="text-zinc-300">NEXT CHALLENGE.</span>
            </h1>
          </div>

          <form onSubmit={handleSearch} className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center mt-10">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Search business cases, essays, hackathons..."
                  className="w-full h-14 sm:h-16 bg-white border-2 border-zinc-900 px-4 sm:px-6 font-bold text-base sm:text-lg focus:outline-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] placeholder-zinc-400 text-zinc-900"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              
              <div className="flex gap-4 shrink-0 overflow-x-auto pb-4 lg:pb-0 hide-scrollbar items-center">
                <button
                  type="button"
                  onClick={() => setIsUpcomingOnly(!isUpcomingOnly)}
                  className={`h-14 sm:h-16 shrink-0 flex items-center justify-center px-4 sm:px-6 border-2 font-bold text-xs sm:text-sm uppercase transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${isUpcomingOnly ? 'bg-blue-100 border-blue-600 text-blue-700' : 'bg-white border-zinc-900 text-zinc-900 hover:bg-zinc-100'}`}
                >
                  Upcoming Only
                </button>

                <button
                  type="submit"
                  disabled={loading}
                  className="h-14 sm:h-16 shrink-0 bg-blue-600 hover:bg-blue-700 border-2 border-zinc-900 text-white px-6 sm:px-8 font-black uppercase text-xs sm:text-sm transition-colors shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-75 disabled:cursor-not-allowed flex items-center justify-center min-w-[120px]"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Search"}
                </button>
              </div>
            </form>

            {/* Status Messages */}
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
          <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 pb-10">
            {displayedCompetitions.map(comp => {
              const isSaved = userData?.savedCompetitions?.includes(comp.id) || false;
              return (
                <div key={comp.id} className="w-full flex items-stretch">
                  <CompetitionCard 
                    competition={comp} 
                    isSaved={isSaved} 
                    isLoggedIn={!!user}
                    onToggleSave={() => handleToggleSave(comp.id, isSaved)}
                  />
                </div>
              );
            })}
          </div>
      </main>
      
      <audio ref={audioRef} loop src="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" />

      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
