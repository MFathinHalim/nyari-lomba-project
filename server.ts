import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Static mock database for all competition categories (Fallback)
  const mockCompetitions = [
    {
      id: "c1",
      title: "National Business Plan 2024",
      shortDescription: "Kompetisi rancangan bisnis nasional untuk mahasiswa dan umum.",
      url: "https://infolomba.id/business-plan-2024",
      source: "InfoLomba",
      deadline: "15 Oct 2024",
      category: "Business",
      tags: ["Business Plan", "Startup", "Mahasiswa"],
      isUpcoming: false
    },
    {
      id: "c2",
      title: "Global Art & Design Jam",
      shortDescription: "A weekend to create stunning digital artworks based on a mystery theme.",
      url: "https://devpost.com/software/art-jam",
      source: "Devpost",
      deadline: "20 Dec 2024",
      category: "Arts",
      tags: ["Design", "Illustration", "UI/UX"],
      isUpcoming: true
    },
    {
      id: "c3",
      title: "Olimpiade Sains Nasional",
      shortDescription: "Ajang bergengsi tingkat nasional untuk pelajar di bidang Matematika, Fisika, Biologi.",
      url: "https://infolomba.id/osn-2024",
      source: "Puspresnas",
      deadline: "10 Nov 2024",
      category: "Science",
      tags: ["Olimpiade", "SMA", "Sains"],
      isUpcoming: true
    },
    {
      id: "c4",
      title: "Campus E-Sports Tournament",
      shortDescription: "Turnamen Mobile Legends dan Valorant antar kampus se-Indonesia.",
      url: "https://infolomba.id/esports-campus",
      source: "InfoLomba",
      deadline: "05 Dec 2024",
      category: "E-Sports",
      tags: ["Gaming", "Mobile Legends", "Valorant"],
      isUpcoming: true
    },
    {
      id: "c5",
      title: "Short Story Writing Contest",
      shortDescription: "Lomba menulis cerpen tema bebas dengan total hadiah puluhan juta.",
      url: "https://infolomba.id/menulis-cerpen",
      source: "Penerbit Indie",
      deadline: "28 Feb 2025",
      category: "Writing",
      tags: ["Cerpen", "Fiksi", "Sastra"],
      isUpcoming: true
    },
    {
      id: "c6",
      title: "Web3 Developer Hackathon",
      shortDescription: "Build decentralized applications and smart contracts.",
      url: "https://devpost.com/web3-hack",
      source: "Devpost",
      deadline: "01 Sep 2024",
      category: "IT",
      tags: ["Blockchain", "Web3", "Hackathon"],
      isUpcoming: false
    }
  ];

  app.get("/api/competitions", async (req, res) => {
    try {
      const q = (req.query.q as string || "").toLowerCase();
      const category = req.query.category as string || "all";

      let filtered = mockCompetitions;
      if (category !== "all") {
        filtered = filtered.filter(c => c.category === category);
      }
      if (q) {
        filtered = filtered.filter(c => 
          c.title.toLowerCase().includes(q) || 
          c.shortDescription.toLowerCase().includes(q) ||
          c.tags.some(t => t.toLowerCase().includes(q))
        );
      }
          
      res.json(filtered);
    } catch (error: any) {
      console.error("Error fetching competitions:", error);
      res.status(500).json({ error: "Failed to fetch competitions." });
    }
  });

  app.get("/api/competitions/batch", (req, res) => {
    try {
      const idsStr = req.query.ids as string || "";
      if (!idsStr) return res.json([]);
      const ids = idsStr.split(',').filter(id => id);
      const filtered = mockCompetitions.filter(c => ids.includes(c.id));
      res.json(filtered);
    } catch (error: any) {
      console.error("Error fetching batch competitions:", error);
      res.status(500).json({ error: "Failed to fetch batch competitions." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
