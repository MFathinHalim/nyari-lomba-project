import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, User, Loader2, Calendar, Shield, Key, Volume2, VolumeX, Sparkles } from "lucide-react";
import { auth, logOut } from "../lib/firebase";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // State untuk Preferensi Lokal (Disimpan di browser, gak perlu database!)
  const [autoMute, setAutoMute] = useState(() => {
    return localStorage.getItem("pref-auto-mute") === "true";
  });

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        navigate('/');
      }
      setAuthLoading(false);
    });
    return () => unsubscribeAuth();
  }, [navigate]);

  const handleToggleMute = () => {
    const newValue = !autoMute;
    setAutoMute(newValue);
    localStorage.setItem("pref-auto-mute", String(newValue));
  };

  const handleLogout = async () => {
    try {
      await logOut();
      navigate("/");
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  // Format tanggal registrasi dari Firebase Metadata
  const formatDate = (dateString?: string) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("id-ID", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-900" />
      </div>
    );
  }

  if (!user) return null;

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

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-10 py-10 sm:py-16">
        
        {/* Grid Layout Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* KIRI: Profile Identity Card */}
          <div className="md:col-span-1 flex flex-col gap-6">
            <div className="bg-white border-2 border-zinc-900 p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-3 bg-blue-600"></div>
              
              <div className="w-24 h-24 mx-auto mt-4 border-2 border-zinc-900 bg-zinc-100 flex items-center justify-center overflow-hidden shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                {user.photoURL ? (
                    <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover grayscale" referrerPolicy="no-referrer" />
                ) : (
                    <User className="w-10 h-10 text-zinc-400" />
                )}
              </div>

              <h2 className="text-2xl font-black tracking-tight mt-6 line-clamp-1">{user.displayName || "Explorer"}</h2>
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mt-1">LOMBA.ID Member</p>
              
              <div className="mt-6 pt-4 border-t-2 border-dashed border-zinc-200 flex flex-col gap-2 text-left text-xs font-bold">
                <div className="flex justify-between">
                  <span className="text-zinc-400">STATUS:</span>
                  <span className="text-green-600 uppercase flex items-center gap-1">
                    <Shield className="w-3 h-3" /> Active
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">ROLE:</span>
                  <span className="text-zinc-900">CHALLENGER</span>
                </div>
              </div>
            </div>

            <button 
              onClick={handleLogout} 
              className="w-full py-4 bg-red-50 hover:bg-red-100 text-red-600 border-2 border-zinc-900 cursor-pointer font-black uppercase text-xs transition shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
            >
              Sign Out Account
            </button>
          </div>

          {/* KANAN: Account Details & Local Preferences */}
          <div className="md:col-span-2 flex flex-col gap-6">
            
            {/* Box 1: Account Meta Info */}
            <div className="bg-white border-2 border-zinc-900 p-6 sm:p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
              <h3 className="text-lg font-black uppercase tracking-tight border-b-2 border-zinc-900 pb-2 mb-6 flex items-center gap-2">
                <Key className="w-5 h-5 text-blue-600" /> Account Security & Info
              </h3>
              
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-zinc-400 block mb-1">Registered Email</label>
                  <div className="p-3 bg-zinc-50 border-2 border-zinc-900 font-bold text-sm">{user.email}</div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black uppercase text-zinc-400 block mb-1">Joined Date</label>
                    <div className="p-3 bg-zinc-50 border-2 border-zinc-900 font-bold text-sm flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-zinc-500" />
                      {formatDate(user.metadata.creationTime)}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-zinc-400 block mb-1">Login Provider</label>
                    <div className="p-3 bg-zinc-50 border-2 border-zinc-900 font-bold text-sm uppercase">
                      {user.providerData[0]?.providerId || "google.com"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Box 2: App Preferences (LocalStorage) */}
            <div className="bg-white border-2 border-zinc-900 p-6 sm:p-8 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
              <h3 className="text-lg font-black uppercase tracking-tight border-b-2 border-zinc-900 pb-2 mb-6 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-600" /> App Preferences
              </h3>

              <div className="flex items-center justify-between p-4 border-2 border-zinc-900 bg-zinc-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 border-2 border-zinc-900 bg-white flex items-center justify-center">
                    {autoMute ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="font-bold text-sm">Mute Audio by Default</p>
                    <p className="text-xs text-zinc-500">Mute latar musik otomatis saat membuka halaman Home.</p>
                  </div>
                </div>
                
                {/* Custom Toggle Switch */}
                <button 
                  onClick={handleToggleMute}
                  className={`w-12 h-6 border-2 border-zinc-900 p-0.5 transition-colors duration-200 focus:outline-none ${autoMute ? 'bg-blue-600' : 'bg-zinc-300'}`}
                >
                  <div className={`w-4 h-4 bg-white border-2 border-zinc-900 transition-transform duration-200 ${autoMute ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
              </div>
            </div>

          </div>
        </div>

      </main>
    </div>
  );
}