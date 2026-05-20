import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, User, Loader2 } from "lucide-react";
import { CompetitionCard } from "../components/CompetitionCard";
import { Competition } from "../types";
import { auth, logOut, subscribeToUserDoc, toggleSavedCompetition } from "../lib/firebase";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [savedCompetitions, setSavedCompetitions] = useState<Competition[]>([]);
  const [loadingComps, setLoadingComps] = useState(false);

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
        // Redirect if logged out while on profile page
        navigate('/');
      }
      setAuthLoading(false);
    });
    return () => {
      unsubscribeAuth();
      if (unsubscribeDoc) unsubscribeDoc();
    }
  }, [navigate]);

  useEffect(() => {
    async function fetchSaved() {
      if (!userData || !userData.savedCompetitions || userData.savedCompetitions.length === 0) {
        setSavedCompetitions([]);
        return;
      }
      setLoadingComps(true);
      try {
        const ids = userData.savedCompetitions.join(',');
        const res = await fetch(`/api/competitions/batch?ids=${ids}`);
        if (!res.ok) throw new Error("Failed to search competitions");
        const data = await res.json();
        setSavedCompetitions(data);
      } catch (err: any) {
        console.error(err);
      } finally {
        setLoadingComps(false);
      }
    }
    
    if (userData) {
      fetchSaved();
    }
  }, [userData]);

  const handleToggleSave = async (compId: string, isSaved: boolean) => {
    if (!user) return;
    try {
      await toggleSavedCompetition(user.uid, compId, isSaved);
    } catch (err) {
      console.error("Failed to toggle save", err);
    }
  };

  const handleLogout = async () => {
    try {
      await logOut();
      navigate("/");
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-900" />
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect via useEffect
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 flex flex-col">
      {/* Header */}
      <nav className="h-20 border-b border-zinc-200 flex items-center px-6 sm:px-10 bg-white shrink-0 sticky top-0 z-10 w-full">
        <Link to="/" className="flex items-center gap-2 group mr-auto">
          <div className="w-10 h-10 border-2 border-zinc-900 flex items-center justify-center transition-colors group-hover:bg-zinc-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <ArrowLeft className="w-5 h-5 text-zinc-900" />
          </div>
          <span className="font-bold text-sm tracking-wide uppercase ml-2 hidden sm:block">Back to Home</span>
        </Link>
        <div className="text-3xl font-black tracking-tighter absolute left-1/2 -translate-x-1/2">LOMBA.<span className="text-blue-600">ID</span></div>
        <button 
          onClick={handleLogout} 
          className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-900 underline uppercase cursor-pointer hidden sm:block font-bold mt-1"
        >
          Sign Out
        </button>
      </nav>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-10 py-10 sm:py-16">
        
        {/* Profile Card */}
        <div className="bg-white border-2 border-zinc-900 p-6 sm:p-10 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col sm:flex-row items-center gap-8 mb-12">
          <div className="w-24 h-24 sm:w-32 sm:h-32 border-2 border-zinc-900 bg-zinc-100 flex items-center justify-center shrink-0 overflow-hidden shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            {user.photoURL ? (
                <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover grayscale" referrerPolicy="no-referrer" />
            ) : (
                <User className="w-10 h-10 text-zinc-400" />
            )}
          </div>
          <div className="flex flex-col items-center sm:items-start text-center sm:text-left gap-2 flex-1">
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight">{user.displayName || "Explorer"}</h1>
            <p className="text-lg font-bold text-zinc-500">{user.email}</p>
          </div>
          <div className="sm:hidden w-full pt-4 border-t-2 border-zinc-100">
            <button 
              onClick={handleLogout} 
              className="w-full py-3 bg-zinc-100 hover:bg-zinc-200 border-2 border-zinc-900 font-bold uppercase text-xs transition"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Saved List */}
        <div>
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-black uppercase">My Saved Challenges</h2>
            <span className="px-3 py-1 bg-zinc-900 text-white font-bold text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              {userData?.savedCompetitions?.length || 0}
            </span>
          </div>

          {loadingComps ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
            </div>
          ) : savedCompetitions.length === 0 ? (
             <div className="bg-zinc-100 border-2 border-dashed border-zinc-400 p-10 flex flex-col items-center justify-center text-center">
                <p className="font-bold text-zinc-400 text-lg">You haven't saved any competitions yet.</p>
                <div className="mt-4 w-12 h-1 bg-zinc-300 mb-6"></div>
                <Link to="/" className="px-6 py-3 bg-zinc-900 text-white font-black uppercase text-xs border-2 border-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-zinc-800 transition">
                  Explore Now
                </Link>
             </div>
          ) : (
            <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              {savedCompetitions.map(comp => (
                <div key={comp.id} className="h-full">
                  <CompetitionCard 
                    competition={comp} 
                    isSaved={true} 
                    isLoggedIn={true}
                    onToggleSave={() => handleToggleSave(comp.id, true)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
