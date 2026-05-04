import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { 
  Users, 
  TrendingUp, 
  Gamepad2, 
  RefreshCw, 
  AlertCircle,
  Clock,
  Search,
  X,
  ShieldCheck,
  Bell,
  BellRing
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface Game {
  appid: number;
  name: string;
  genre: string;
  header_image: string;
  current_players: number | null;
  final_price: number | null;
  price_formatted?: string;
  discount_percent: number;
  rating: number | null;
  owners: string;
}

interface SteamStats {
  online_users: number;
  peak_24h: number;
  total_accounts: number;
}

interface User {
  steamid: string;
  personaname: string;
  avatarfull: string;
  profileurl: string;
}

interface UserStats {
  total_playtime_hours: number;
  games_count: number;
  games_played: number;
  top_played: any[];
  achievements_by_game?: Record<number, any[]>;
  latest_achievements?: Record<number, any[]>;
}

interface Deal {
  appid: number;
  name: string;
  header_image: string;
  original_price?: number;
  final_price?: number;
  discount_percent: number;
  price_currency?: string;
}

interface DetailedGame {
  appid: number;
  name: string;
  description: string;
  header_image: string;
  dlc_count: number;
  achievement_count: number;
  achievements: any[];
  current_players: number;
  player_history: number[];
  price: any;
  developers: string[];
  publishers: string[];
  release_date: string;
}

const App: React.FC = () => {
  const [games, setGames] = useState<Game[]>([]);
  const [stats, setStats] = useState<SteamStats | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'trending' | 'deals' | 'personal' | 'friends' | 'sentiment' | 'reviews' | 'finance' | 'diagram'>('trending');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Game[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedGame, setSelectedGame] = useState<DetailedGame | null>(null);
  const [showStatsOnly, setShowStatsOnly] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showAllAchievements, setShowAllAchievements] = useState(false);
  const [serverStatus, setServerStatus] = useState<any[]>([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [userFriends, setUserFriends] = useState<any[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [selectedFriend, setSelectedFriend] = useState<any | null>(null);
  const [friendStats, setFriendStats] = useState<UserStats | null>(null);
  const [loadingFriendStats, setLoadingFriendStats] = useState(false);
  const [gameReviews, setGameReviews] = useState<Record<number, any>>({});
  const [yearlyStats, setYearlyStats] = useState<any[]>([]);
  const [loadingFinance, setLoadingFinance] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchFriendStats = async (friend: any) => {
    setSelectedFriend(friend);
    setLoadingFriendStats(true);
    setFriendStats(null);
    try {
      const res = await fetch(`/api/user/friends/stats/${friend.steamid}`);
      if (res.ok) {
        const data = await res.json();
        setFriendStats(data);
      } else {
        const err = await res.json();
        alert(err.error || 'ไม่สามารถโหลดสถิติได้ (โปรไฟล์อาจเป็นส่วนตัว)');
        setSelectedFriend(null);
      }
    } catch (err) {
      console.error('Friend stats error:', err);
    } finally {
      setLoadingFriendStats(false);
    }
  };

  const handleFriendSearch = async () => {
    if (!friendSearchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/user/search/${encodeURIComponent(friendSearchQuery)}`);
      const data = await res.json();
      if (res.ok) {
        fetchFriendStats(data);
      } else {
        alert(data.error || 'ไม่พบผู้ใช้');
      }
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการค้นหา');
    } finally {
      setIsSearching(false);
    }
  };

  const formatPrice = (price: number, currency: string) => {
    if (currency === 'THB') {
      return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(price);
    }
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(price);
  };

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(`/api/games/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.games || []);
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const fetchGameReviews = async (appid: number) => {
    setGameReviews(prev => ({ ...prev, [appid]: { ...(prev[appid] || {}), loading: true } }));
    try {
      const res = await fetch(`/api/games/reviews/${appid}`);
      if (res.ok) {
        const data = await res.json();
        setGameReviews(prev => ({ ...prev, [appid]: { ...data, loading: false } }));
      } else {
        const err = await res.json().catch(() => ({}));
        setGameReviews(prev => ({ ...prev, [appid]: { error: err?.error || 'โหลดรีวิวไม่สำเร็จ', reviews: [], loading: false } }));
      }
    } catch (err) {
      console.error('Reviews fetch error:', err);
      setGameReviews(prev => ({ ...prev, [appid]: { error: 'โหลดรีวิวไม่สำเร็จ', reviews: [], loading: false } }));
    }
  };

  const fetchGameDetail = async (appid: number, statsOnly: boolean = false) => {
    setLoadingDetail(true);
    setShowStatsOnly(statsOnly);
    setSearchQuery('');
    try {
      const res = await fetch(`/api/games/details/${appid}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedGame(data);
        setShowAllAchievements(false);
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(`ไม่สามารถโหลดรายละเอียดเกมได้: ${errorData.error || 'Steam API อาจจะบล็อกการเชื่อมต่อชั่วคราว (403)'}`);
      }
    } catch (err) {
      console.error('Fetch detail error:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery) {
      searchTimeoutRef.current = setTimeout(() => {
        handleSearch(searchQuery);
      }, 300);
    } else {
      setSearchResults([]);
      setIsSearching(false);
    }

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, handleSearch]);

  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const fetchWithTimeout = (url: string) => 
        fetch(url, { signal: controller.signal }).catch(e => {
          console.warn(`Fetch failed for ${url}:`, e);
          return { ok: false, json: () => Promise.resolve(null) };
        });

      const gamesRes = await fetchWithTimeout('/api/games');
      if (gamesRes.ok) {
        const gamesData = await gamesRes.json();
        setGames(gamesData?.games || []);
        setError(null);
      } else {
        setError('โหลดข้อมูลเกมไม่ได้ (backend อาจยังไม่ทำงาน หรือเชื่อมต่อไม่ได้)');
      }
      setLoading(false);

      const [statsRes, userRes, dealsRes] = await Promise.all([
        fetchWithTimeout('/api/steam/stats'),
        fetchWithTimeout('/api/user/profile'),
        fetchWithTimeout('/api/games/deals')
      ]);

      clearTimeout(timeoutId);

      const statsData = statsRes.ok ? await statsRes.json() : null;
      const dealsData = dealsRes.ok ? await dealsRes.json() : null;
      
      if (statsData) setStats(statsData);
      if (dealsData) setDeals(dealsData?.deals || []);

      if (userRes.ok) {
        const userData = await userRes.json();
        if (userData) {
          setUser(userData);
          fetch('/api/user/games/stats')
            .then(res => res.ok ? res.json() : null)
            .then(uStats => uStats && setUserStats(uStats))
            .catch(err => console.error('User stats error:', err));
        }
      }

      setLastUpdated(new Date());

      fetch('/api/steam/status')
        .then(res => res.ok ? res.json() : { services: [] })
        .then(data => setServerStatus(data.services || []))
        .catch(err => console.error('Status fetch error:', err));

    } catch (err) {
      console.error('Fetch error:', err);
      setLoading(false);
      setError('เกิดข้อผิดพลาดระหว่างโหลดข้อมูล');
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (activeTab === 'friends' && user && userFriends.length === 0) {
      setLoadingFriends(true);
      fetch('/api/user/friends')
        .then(res => res.ok ? res.json() : { friends: [] })
        .then(data => setUserFriends(data.friends || []))
        .catch(err => console.error('Friends fetch error:', err))
        .finally(() => setLoadingFriends(false));
    }
  }, [activeTab, user, userFriends.length]);

  useEffect(() => {
    if (activeTab === 'reviews' && games.length > 0) {
      // ทยอยโหลดทีละเกมเพื่อไม่ให้โดน Steam Block (Rate Limit)
      const gamesToFetch = games.slice(0, 6);
      
      gamesToFetch.forEach((game, index) => {
        // โหลดเฉพาะเกมที่ยังไม่มีข้อมูล หรือเคยโหลดแล้วพัง
        if (!gameReviews[game.appid] || gameReviews[game.appid].error) {
          setTimeout(() => {
            fetchGameReviews(game.appid);
          }, index * 1000); // ห่างกันเกมละ 1 วินาที
        }
      });
    }
  }, [activeTab, games]);

  useEffect(() => {
    if (activeTab === 'finance' && yearlyStats.length === 0) {
      setLoadingFinance(true);
      fetch('/api/steam/yearly-stats')
        .then(res => res.ok ? res.json() : { stats: [] })
        .then(data => setYearlyStats(data.stats || []))
        .catch(err => console.error('Finance fetch error:', err))
        .finally(() => setLoadingFinance(false));
    }
  }, [activeTab, yearlyStats.length]);

  const requestNotificationPermission = () => {
    if (!("Notification" in window)) {
      alert("เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน");
      return;
    }

    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        setNotificationsEnabled(true);
        new Notification("แดชบอร์ด Steam", {
          body: "ขอบคุณที่เปิดการแจ้งเตือน! เราจะแจ้งคุณเมื่อมีดีลใหม่",
          icon: "/favicon.ico"
        });
      }
    });
  };

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "granted") {
      setNotificationsEnabled(true);
    }
  }, []);

  const topGamesChartData = {
    labels: games.slice(0, 7).map(g => g.name),
    datasets: [
      {
        label: 'จำนวนผู้เล่นปัจจุบัน',
        data: games.slice(0, 7).map(g => g.current_players || 0),
        backgroundColor: 'rgba(102, 192, 244, 0.6)',
        borderColor: '#66c0f4',
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };

  const trendData = {
    labels: ['เที่ยงคืน', '4 โมงเช้า', '8 โมงเช้า', 'เที่ยงวัน', '4 โมงเย็น', '2 ทุ่ม', 'ตอนนี้'],
    datasets: [
      {
        fill: true,
        label: 'ผู้เล่นที่ใช้งาน (ล้านคน)',
        data: [21, 18, 22, 26, 31, 29, (stats?.online_users || 0) / 1000000],
        borderColor: '#66c0f4',
        backgroundColor: 'rgba(102, 192, 244, 0.2)',
        tension: 0.4,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#171a21',
        titleColor: '#66c0f4',
        bodyColor: '#c7d5e0',
        borderColor: 'rgba(102, 192, 244, 0.2)',
        borderWidth: 1,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(42, 71, 94, 0.2)' },
        ticks: { color: '#c7d5e0' },
      },
      x: {
        grid: { display: false },
        ticks: { color: '#c7d5e0' },
      },
    },
  };

  if (loading && !isRefreshing && games.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#1b2838] text-[#c7d5e0]">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 animate-spin mx-auto mb-4 text-[#66c0f4]" />
          <h2 className="text-2xl font-bold">กำลังโหลดแดชบอร์ด Steam...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#171a21] text-[#c7d5e0] p-6 md:p-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Gamepad2 className="text-[#66c0f4]" />
              แดชบอร์ด Steam
            </h1>
            <p className="text-[#c7d5e0] opacity-70 flex items-center gap-2 mt-1">
              <Clock size={14} />
              อัปเดตล่าสุด: {lastUpdated.toLocaleTimeString('th-TH')}
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3 bg-[#2a475e]/40 p-2 pr-4 rounded-full border border-[#66c0f4]/20">
                <img src={user.avatarfull} alt={user.personaname} className="w-10 h-10 rounded-full border-2 border-[#66c0f4]" />
                <div>
                  <p className="text-white font-bold leading-tight">{user.personaname}</p>
                  <a href="/api/auth/logout" className="text-xs text-[#66c0f4] hover:underline">ออกจากระบบ</a>
                </div>
              </div>
            ) : (
              <a 
                href="/api/auth/login"
                className="flex items-center gap-2 bg-[#2a475e] hover:bg-[#66c0f4] hover:text-[#171a21] transition-all px-4 py-2 rounded-md font-medium"
              >
                เข้าสู่ระบบด้วย Steam
              </a>
            )}

            <button 
              onClick={requestNotificationPermission}
              className={`p-2 rounded-full border transition-all ${notificationsEnabled ? 'border-green-500/50 bg-green-500/10 text-green-400' : 'border-[#66c0f4]/20 bg-[#2a475e]/20 text-[#66c0f4] hover:bg-[#66c0f4]/10'}`}
              title={notificationsEnabled ? "เปิดการแจ้งเตือนแล้ว" : "เปิดการแจ้งเตือน"}
            >
              {notificationsEnabled ? <BellRing size={20} /> : <Bell size={20} />}
            </button>
          </div>
        </div>
        <button 
          onClick={fetchData}
          disabled={isRefreshing}
          className="flex items-center gap-2 bg-[#2a475e] hover:bg-[#66c0f4] hover:text-[#171a21] transition-all px-4 py-2 rounded-md font-medium disabled:opacity-50"
        >
          <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
          รีเฟรชข้อมูล
        </button>
      </div>

      <div className="relative mb-8 max-w-2xl mx-auto">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#66c0f4] opacity-50" size={20} />
          <input 
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาชื่อเกม หรือหมวดหมู่..."
            className="w-full bg-[#1b2838] border border-[#66c0f4]/20 rounded-full py-3 pl-12 pr-12 text-white focus:outline-none focus:border-[#66c0f4] focus:shadow-glow transition-all"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <AnimatePresence>
          {searchQuery && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-full left-0 right-0 mt-2 bg-[#1b2838] border border-[#66c0f4]/20 rounded-xl shadow-2xl z-50 max-h-[400px] overflow-y-auto"
            >
              {isSearching ? (
                <div className="p-4 text-center opacity-50 flex items-center justify-center gap-2">
                  <RefreshCw size={16} className="animate-spin" />
                  กำลังค้นหา...
                </div>
              ) : searchResults.length > 0 ? (
                <div className="p-2">
                  {searchResults.map((game) => (
                    <div 
                      key={game.appid}
                      onClick={() => fetchGameDetail(game.appid)}
                      className="flex items-center gap-4 p-2 hover:bg-[#2a475e]/50 rounded-lg transition-colors cursor-pointer group"
                    >
                      <img src={game.header_image} alt={game.name} className="w-20 h-10 object-cover rounded" />
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-bold truncate">{game.name}</p>
                        <p className="text-xs opacity-50">{game.genre}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[#66c0f4] font-mono text-sm">{game.current_players?.toLocaleString()}</p>
                        <p className="text-[10px] opacity-30 uppercase">ผู้เล่น</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center opacity-50">ไม่พบเกมที่ค้นหา</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500/50 p-4 rounded-lg flex items-center gap-3 mb-8">
          <AlertCircle className="text-red-500" />
          <p>{error}</p>
        </div>
      )}

      <div className="flex gap-4 mb-8 border-b border-[#66c0f4]/10 pb-1">
        <TabButton active={activeTab === 'trending'} onClick={() => setActiveTab('trending')} label="🔥 เกมที่กำลังฮิต" />
        <TabButton active={activeTab === 'deals'} onClick={() => setActiveTab('deals')} label="💰 ดีลลดราคาพิเศษ" />
        {user && <TabButton active={activeTab === 'personal'} onClick={() => setActiveTab('personal')} label="👤 สถิติส่วนตัว" />}
        <TabButton active={activeTab === 'friends'} onClick={() => setActiveTab('friends')} label="🔍 ค้นหาเพื่อน" />
        <TabButton active={activeTab === 'sentiment'} onClick={() => setActiveTab('sentiment')} label="📊 วิเคราะห์กระแส" />
        <TabButton active={activeTab === 'reviews'} onClick={() => setActiveTab('reviews')} label="💬 รีวิวจากผู้ใช้" />
        <TabButton active={activeTab === 'finance'} onClick={() => setActiveTab('finance')} label="💰 รายได้รายปี" />
        <TabButton active={activeTab === 'diagram'} onClick={() => setActiveTab('diagram')} label="📊 Diagram" />
      </div>

      {activeTab === 'trending' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            <StatCard icon={<Users className="text-green-400" />} label="ผู้เล่นออนไลน์" value={stats?.online_users.toLocaleString() || '0'} trend="+2.4% จากชั่วโมงที่แล้ว" />
            <StatCard icon={<TrendingUp className="text-[#66c0f4]" />} label="สูงสุดใน 24 ชม." value={stats?.peak_24h.toLocaleString() || '0'} trend="สูงสุดเป็นประวัติการณ์" />
            <StatCard icon={<Gamepad2 className="text-purple-400" />} label="เกมที่ติดตาม" value={games.length.toString()} trend="100 เกมยอดนิยม" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              <div className="glass-card rounded-xl p-6 h-[400px] flex flex-col">
                <h3 className="text-xl font-semibold mb-6 text-white">การกระจายตัวของผู้เล่นปัจจุบัน</h3>
                <div className="flex-1 min-h-0">{games.length > 0 ? <Bar data={topGamesChartData} options={chartOptions} /> : <div className="h-full flex items-center justify-center opacity-50">ไม่มีข้อมูลผู้เล่น</div>}</div>
              </div>
              <div className="glass-card rounded-xl p-6 overflow-hidden">
                <h3 className="text-xl font-semibold mb-6 text-white">เกมที่กำลังมาแรง</h3>
                <div className="space-y-4">{games.slice(0, 5).map((game, index) => <GameRow key={game.appid} game={game} index={index} onSelect={fetchGameDetail} />)}</div>
              </div>
            </div>
            <div className="space-y-8">
              <div className="glass-card rounded-xl p-6 h-[300px] flex flex-col">
                <h3 className="text-xl font-semibold mb-6 text-white">แนวโน้มผู้เล่นใน 24 ชม.</h3>
                <div className="flex-1 min-h-0"><Line data={trendData} options={chartOptions} /></div>
              </div>
              <div className="glass-card rounded-xl p-6 flex-1 flex flex-col text-white">
                <h3 className="text-xl font-semibold mb-6 flex items-center gap-2"><TrendingUp size={20} className="text-[#66c0f4]" />ภาพรวมตลาด</h3>
                <div className="space-y-6 flex-1">
                  <MarketStat icon={<Users size={16} />} label="คะแนนผู้เล่นเฉลี่ย" value={`${games.length > 0 ? Math.round(games.reduce((acc, g) => acc + (g.rating || 0), 0) / (games.length || 1)) : 0}%`} showProgress={games.length > 0} progressValue={games.length > 0 ? Math.round(games.reduce((acc, g) => acc + (g.rating || 0), 0) / (games.length || 1)) : 0} />
                  <MarketStat icon={<TrendingUp size={16} />} label="เกมที่ลดราคา" value={`${games.filter(g => g.discount_percent > 0).length} รายการ`} />
                  <MarketStat icon={<Gamepad2 size={16} />} label="หมวดหมู่เกมที่ใช้งาน" value={`${new Set(games.map(g => g.genre)).size} หมวดหมู่`} />
                </div>
                <div className="mt-8 space-y-3">
                  <h4 className="text-xs uppercase tracking-widest text-[#66c0f4] font-bold">สถานะเซิร์ฟเวอร์ Steam</h4>
                  <div className="grid grid-cols-1 gap-2">
                    {serverStatus.map((s, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-black/20 p-2 rounded-lg border border-white/5">
                        <span className="text-xs opacity-70">{s.service}</span>
                        <div className="flex items-center gap-1.5"><div className={`w-1.5 h-1.5 rounded-full ${s.status === 'online' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : s.status === 'delayed' ? 'bg-yellow-500' : 'bg-red-500'}`} /><span className={`text-[10px] font-bold uppercase ${s.status === 'online' ? 'text-green-400' : s.status === 'delayed' ? 'text-yellow-400' : 'text-red-400'}`}>{s.status === 'online' ? 'ปกติ' : s.status === 'delayed' ? 'ล่าช้า' : 'ออฟไลน์'}</span></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'deals' && (
        <div className="space-y-8">
          <div className="glass-card rounded-xl p-6 overflow-hidden">
            <h3 className="text-xl font-semibold mb-6 text-white">ดีลลดราคาพิเศษ</h3>
            {deals.length === 0 ? (
              <div className="h-[300px] flex flex-col items-center justify-center opacity-50 gap-3">
                <p>ยังไม่มีข้อมูลดีล (ลองกดรีเฟรช หรือ backend ยังไม่ได้สร้างแคช)</p>
                <button
                  onClick={fetchData}
                  disabled={isRefreshing}
                  className="flex items-center gap-2 bg-[#2a475e] hover:bg-[#66c0f4] hover:text-[#171a21] transition-all px-4 py-2 rounded-md font-medium disabled:opacity-50"
                >
                  <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
                  รีเฟรชข้อมูล
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {deals.map((d) => (
                  <div
                    key={`deal-${d.appid}`}
                    onClick={() => fetchGameDetail(d.appid)}
                    className="bg-[#1b2838] rounded-xl border border-white/5 overflow-hidden cursor-pointer hover:border-[#66c0f4]/40 transition-colors"
                  >
                    <img src={d.header_image} alt={d.name} className="w-full h-32 object-cover" />
                    <div className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-bold text-white text-sm leading-snug line-clamp-2">{d.name}</h4>
                        {d.discount_percent > 0 && (
                          <span className="text-[10px] font-bold bg-green-500/20 text-green-400 px-2 py-1 rounded-full shrink-0">
                            -{d.discount_percent}%
                          </span>
                        )}
                      </div>

                      <div className="flex items-baseline justify-between">
                        <div className="text-sm font-bold text-green-400">
                          {typeof d.final_price === 'number'
                            ? formatPrice(d.final_price, d.price_currency || 'THB')
                            : 'Free'}
                        </div>
                        {typeof d.original_price === 'number' && d.original_price > 0 && (
                          <div className="text-xs opacity-40 line-through">
                            {formatPrice(d.original_price, d.price_currency || 'THB')}
                          </div>
                        )}
                      </div>
                      <div className="text-[10px] opacity-40">คลิกเพื่อดูรายละเอียด</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'personal' && (
        <div className="space-y-8">
          <div className="glass-card rounded-2xl p-6 text-white">
            <h3 className="text-xl font-semibold mb-6">สถิติส่วนตัว</h3>

            {!user ? (
              <div className="h-[260px] flex flex-col items-center justify-center opacity-50 gap-3 text-center">
                <p>กรุณาเข้าสู่ระบบด้วย Steam ก่อน</p>
                <a
                  href="/api/auth/login"
                  className="flex items-center gap-2 bg-[#2a475e] hover:bg-[#66c0f4] hover:text-[#171a21] transition-all px-4 py-2 rounded-md font-medium"
                >
                  เข้าสู่ระบบด้วย Steam
                </a>
              </div>
            ) : !userStats ? (
              <div className="h-[260px] flex flex-col items-center justify-center opacity-50 gap-3 text-center">
                <RefreshCw className="w-10 h-10 animate-spin text-[#66c0f4]" />
                <p>กำลังโหลดสถิติส่วนตัว...</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                  <div className="bg-[#1b2838] p-5 rounded-2xl border border-white/5 text-center">
                    <p className="text-[10px] uppercase tracking-widest opacity-40 mb-1">ชั่วโมงเล่นทั้งหมด</p>
                    <p className="text-2xl font-bold text-[#66c0f4]">{userStats.total_playtime_hours.toLocaleString()} ชม.</p>
                  </div>
                  <div className="bg-[#1b2838] p-5 rounded-2xl border border-white/5 text-center">
                    <p className="text-[10px] uppercase tracking-widest opacity-40 mb-1">จำนวนเกมที่มี</p>
                    <p className="text-2xl font-bold text-purple-400">{userStats.games_count.toLocaleString()}</p>
                  </div>
                  <div className="bg-[#1b2838] p-5 rounded-2xl border border-white/5 text-center">
                    <p className="text-[10px] uppercase tracking-widest opacity-40 mb-1">จำนวนเกมที่เคยเล่น</p>
                    <p className="text-2xl font-bold text-green-400">{userStats.games_played.toLocaleString()}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="bg-[#1b2838] p-6 rounded-2xl border border-white/5">
                    <h4 className="text-sm font-bold mb-4">เกมที่เล่นมากที่สุด</h4>
                    {userStats.top_played?.length ? (
                      <div className="space-y-3">
                        {userStats.top_played.slice(0, 8).map((g: any) => (
                          <div
                            key={g.appid}
                            onClick={() => fetchGameDetail(g.appid, true)}
                            className="flex items-center gap-4 bg-black/20 p-3 rounded-lg border border-white/5 cursor-pointer hover:border-[#66c0f4]/30 transition-colors"
                          >
                            <img
                              src={`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/header.jpg`}
                              alt={g.name}
                              className="w-24 h-12 object-cover rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold truncate">{g.name}</p>
                              <p className="text-xs text-[#66c0f4] font-mono">{Math.round((g.playtime_forever || 0) / 60)} ชม.</p>
                            </div>
                            <div className="text-[10px] opacity-40">ดูสถิติ</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-[180px] flex items-center justify-center opacity-40">ไม่พบข้อมูลเกม</div>
                    )}
                  </div>

                  <div className="bg-[#1b2838] p-6 rounded-2xl border border-white/5">
                    <h4 className="text-sm font-bold mb-4">ความสำเร็จล่าสุด</h4>
                    {userStats.latest_achievements && Object.keys(userStats.latest_achievements).length > 0 ? (
                      <div className="space-y-5">
                        {Object.entries(userStats.latest_achievements).slice(0, 3).map(([appid, achList]: any) => (
                          <div key={`ua-${appid}`} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs opacity-60 font-mono">AppID: {appid}</p>
                              <button
                                onClick={() => fetchGameDetail(Number(appid), true)}
                                className="text-[10px] text-[#66c0f4] hover:underline"
                              >
                                ดูสถิติเกม
                              </button>
                            </div>
                            <div className="grid grid-cols-8 sm:grid-cols-10 gap-2">
                              {(achList || []).slice(0, 10).map((a: any, idx: number) => (
                                <div
                                  key={`${appid}-${idx}`}
                                  className={`aspect-square p-1 rounded-md border border-white/5 ${a.unlocked ? 'bg-green-500/10' : 'bg-black/40 opacity-30'}`}
                                >
                                  <img src={a.icon} alt="ach" className={`w-full h-full rounded ${a.unlocked ? 'grayscale-0' : 'grayscale'}`} />
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-[180px] flex items-center justify-center opacity-40">ยังไม่มีข้อมูลความสำเร็จ</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'sentiment' && (
        <div className="space-y-8">
          <div className="glass-card rounded-2xl p-6 text-white">
            <h3 className="text-xl font-semibold mb-6">วิเคราะห์กระแส</h3>

            {games.length === 0 ? (
              <div className="h-[260px] flex flex-col items-center justify-center opacity-50 gap-3 text-center">
                <p>ยังไม่มีข้อมูลเกมให้วิเคราะห์ (ลองกดรีเฟรชข้อมูล)</p>
                <button
                  onClick={fetchData}
                  disabled={isRefreshing}
                  className="flex items-center gap-2 bg-[#2a475e] hover:bg-[#66c0f4] hover:text-[#171a21] transition-all px-4 py-2 rounded-md font-medium disabled:opacity-50"
                >
                  <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
                  รีเฟรชข้อมูล
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {games.slice(0, 12).map((game, index) => (
                  <GameRow key={`sentiment-${game.appid}`} game={game} index={index} onSelect={fetchGameDetail} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'diagram' && (
        <div className="space-y-8">
          <div className="glass-card rounded-3xl p-10 text-white min-h-[950px] flex flex-col items-center overflow-hidden bg-[#0b111a] relative">
            <h2 className="text-2xl font-black mb-16 flex items-center gap-3 self-start border-b border-white/5 pb-4 w-full uppercase tracking-tighter">
              <TrendingUp className="text-[#66c0f4]" />
              Data Pipeline & Architecture flow
            </h2>
            
            <div className="relative w-full max-w-[1100px] flex flex-col items-center">
              {/* SVG Layer เวอร์ชันสมบูรณ์ - เส้นคมชัดและเล็งตรงเป้า */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-0" style={{ minHeight: '950px' }}>
                <defs>
                  <linearGradient id="lineGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#66c0f4" stopOpacity="0.2" />
                    <stop offset="50%" stopColor="#66c0f4" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#66c0f4" stopOpacity="0.2" />
                  </linearGradient>
                  {/* หัวลูกศรขนาดใหญ่ ทึบแสง 100% */}
                  <marker id="arrowhead" markerWidth="14" markerHeight="10" refX="12" refY="5" orient="auto">
                    <polygon points="0 0, 14 5, 0 10" fill="#66c0f4" fillOpacity="1" />
                  </marker>
                </defs>
                
                {/* 1. Data Source (Top) -> 2. steam_fetcher.py (Center) */}
                <AnimatedPath d="M 550 140 L 550 225" />
                
                {/* 2. steam_fetcher.py -> Storage Nodes */}
                {/* ชี้ลงหา JSON (Center) */}
                <AnimatedPath d="M 550 280 L 550 330" />
                {/* ชี้เฉียงหา AVRO (Left) - ปรับพิกัดใหม่ให้ตรงกลางกล่องซ้าย */}
                <AnimatedPath d="M 430 260 L 170 330" />
                {/* ชี้เฉียงหา PARQUET (Right) - ปรับพิกัดใหม่ให้ตรงกลางกล่องขวา */}
                <AnimatedPath d="M 670 260 L 930 330" />
                
                {/* Storage Nodes -> 3. FastAPI Backend (จุดรวมข้อมูล) */}
                {/* จากซ้าย เล็งเข้าหา Backend จุดรวมที่ X=500 */}
                <AnimatedPath d="M 170 435 L 500 500" />
                {/* จากกลาง ลงตรงๆ X=550 */}
                <AnimatedPath d="M 550 435 L 550 500" />
                {/* จากขวา เล็งเข้าหา Backend จุดรวมที่ X=600 */}
                <AnimatedPath d="M 930 435 L 600 500" />
                
                {/* 3. FastAPI Backend -> 4. React Frontend (Center) */}
                <AnimatedPath d="M 550 645 L 550 755" />
              </svg>

              {/* Layer 1: Data Source */}
              <div className="z-10 mb-20">
                <DiagramNode title="1. Data Source" items={['Steam Web API (Official Content)', 'SteamSpy API (Market Stats)']} color="bg-[#66c0f4]/5" borderColor="border-[#66c0f4]/20" />
              </div>

              {/* Layer 2: Pipeline */}
              <div className="z-10 w-full bg-[#1b2838]/40 border border-white/5 rounded-[40px] p-12 mb-20 relative backdrop-blur-2xl shadow-2xl">
                <div className="absolute -top-4 left-12 bg-gradient-to-r from-[#66c0f4] to-[#4e8db3] text-[#0b111a] px-6 py-1.5 rounded-full text-[11px] font-black uppercase tracking-widest shadow-lg shadow-[#66c0f4]/20">
                  2. Automation & Data Processing Pipeline
                </div>
                
                <div className="flex flex-col items-center gap-16">
                  {/* Processing Engine */}
                  <motion.div 
                    whileHover={{ scale: 1.05, boxShadow: "0 0 30px rgba(249, 115, 22, 0.2)" }}
                    className="bg-orange-500/10 border-2 border-orange-500/40 p-8 rounded-3xl flex items-center gap-6 relative overflow-hidden group"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-orange-500/0 via-orange-500/5 to-orange-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                    <div className="relative">
                      <RefreshCw className="text-orange-400 animate-spin-slow" size={40} />
                      <div className="absolute inset-0 blur-xl bg-orange-400/30 animate-pulse" />
                    </div>
                    <div className="text-left">
                      <div className="text-orange-400 font-black text-base uppercase tracking-[0.2em]">steam_fetcher.py</div>
                      <div className="text-[10px] opacity-50 font-mono tracking-tighter">Validation • Aggregation • Normalization</div>
                    </div>
                  </motion.div>

                  {/* Multi-Format Storage - ปรับ Layout ให้สมดุลกับพิกัด SVG */}
                  <div className="flex justify-around w-full px-4">
                    <StorageNode title="High Speed Cache" sub="steam_cache.avro" type="avro" />
                    <StorageNode title="Flat Metadata" sub="summary.json" type="json" />
                    <StorageNode title="Analytical Data" sub="analytics.parquet" type="parquet" />
                  </div>
                </div>
              </div>

              {/* Layer 3: Backend */}
              <div className="z-10 w-full bg-green-500/5 border border-green-500/10 rounded-3xl p-8 mb-20 relative">
                <div className="absolute -top-4 left-8 bg-green-500 text-[#0b111a] px-4 py-1 rounded-full text-[10px] font-black uppercase">
                  3. FastAPI Backend
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <ApiEndpoint method="GET" path="/api/games" desc="Dashboard" />
                  <ApiEndpoint method="GET" path="/api/details" desc="Game Info" />
                  <ApiEndpoint method="GET" path="/api/user" desc="Profile" />
                  <ApiEndpoint method="POST" path="/api/refresh" desc="Refresh" />
                </div>
              </div>

              {/* Layer 4: Frontend */}
              <div className="z-10 w-full max-w-2xl bg-purple-500/5 border border-purple-500/20 p-8 rounded-3xl text-center relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-purple-500 to-transparent" />
                <h3 className="text-lg font-black text-purple-400 mb-4 uppercase tracking-widest">4. React Dashboard</h3>
                <div className="flex justify-center gap-4">
                  <TechBadge label="React 18" />
                  <TechBadge label="Chart.js" />
                  <TechBadge label="Tailwind" />
                  <TechBadge label="Framer" />
                </div>
              </div>
            </div>
          </div>
          <div className="glass-card rounded-2xl p-8 text-white h-[450px] flex flex-col">
            <h3 className="text-xl font-semibold mb-8 flex items-center gap-2 border-b border-white/5 pb-4">📊 กราฟเปรียบเทียบรายได้และยอดขาย (5 ปีล่าสุด)</h3>
            <div className="flex-1 min-h-0">
              {loadingFinance ? <div className="h-full flex flex-col items-center justify-center opacity-40"><RefreshCw className="animate-spin mb-2" /><p className="text-xs">กำลังคำนวณข้อมูลการเงิน...</p></div> : (
                <Bar 
                  data={{ 
                    labels: yearlyStats.map(s => s.year), 
                    datasets: [
                      { 
                        label: 'รายได้ประเมิน (ล้าน ฿)', 
                        data: yearlyStats.map(s => s.revenue / 1000000), 
                        backgroundColor: 'rgba(102, 192, 244, 0.7)', 
                        borderColor: '#66c0f4',
                        borderWidth: 1,
                        borderRadius: 6 
                      },
                      { 
                        label: 'ยอดขาย (หมื่นชุด)', 
                        data: yearlyStats.map(s => s.sales / 10000), 
                        backgroundColor: 'rgba(34, 197, 94, 0.7)', 
                        borderColor: '#22c55e',
                        borderWidth: 1,
                        borderRadius: 6 
                      }
                    ] 
                  }} 
                  options={{ 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    plugins: { 
                      legend: { 
                        display: true, 
                        position: 'top',
                        labels: { color: '#ffffff', font: { size: 12, weight: 'bold' }, padding: 20 } 
                      },
                      tooltip: {
                        backgroundColor: '#1b2838',
                        titleFont: { size: 14 },
                        bodyFont: { size: 13 },
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: true
                      }
                    }, 
                    scales: { 
                      y: { 
                        grid: { color: 'rgba(255,255,255,0.05)' }, 
                        ticks: { color: '#c7d5e0', font: { size: 11 } } 
                      }, 
                      x: { 
                        grid: { display: false }, 
                        ticks: { color: '#ffffff', font: { size: 12, weight: 'bold' } } 
                      } 
                    } 
                  }} 
                />
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {yearlyStats.map((s) => (
              <div key={s.year} className="bg-white/5 p-4 rounded-xl border border-white/5 text-center">
                <p className="text-lg font-bold text-[#66c0f4] mb-1">{s.year}</p>
                <p className="text-[10px] opacity-40 uppercase">ขายได้ {s.game_count} เกม</p>
                <div className="mt-2 pt-2 border-t border-white/5"><p className="text-xs font-bold text-green-400">฿{(s.revenue / 1000000).toFixed(1)}M</p></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'reviews' && (
        <div className="space-y-8">
          <div className="glass-card rounded-2xl p-6 text-white">
            <h3 className="text-xl font-semibold mb-6 flex items-center gap-2 border-b border-[#66c0f4]/20 pb-4"><Clock size={20} className="text-[#66c0f4]" />รีวิวและความคิดเห็นล่าสุด</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {games.slice(0, 12).map((game) => {
                const reviewsData = gameReviews[game.appid];
                const positivePercent = reviewsData?.total_reviews > 0 
                  ? Math.round((reviewsData.total_positive / reviewsData.total_reviews) * 100) 
                  : 0;

                return (
                  <div key={`rev-card-${game.appid}`} className="bg-[#1b2838] rounded-xl border border-white/5 overflow-hidden flex flex-col">
                    <div className="p-4 flex gap-4 border-b border-white/5 bg-white/5">
                      <img src={game.header_image} alt={game.name} className="w-20 h-10 object-cover rounded shadow-md" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-xs truncate text-white">{game.name}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex items-center gap-1">
                            <TrendingUp size={10} className="text-blue-400" />
                            <span className="text-[9px] text-blue-400 font-bold">{positivePercent}%</span>
                          </div>
                          <div className="flex-1 h-1 bg-red-500/30 rounded-full overflow-hidden max-w-[60px]">
                            <div className="h-full bg-blue-500 transition-all duration-1000" style={{ width: `${positivePercent}%` }} />
                          </div>
                          <div className="flex items-center gap-1">
                            <TrendingUp size={10} className="text-red-400 rotate-180" />
                            <span className="text-[9px] text-red-400 font-bold">{100 - positivePercent}%</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <div className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                          <span className="text-[7px] text-green-500 uppercase font-bold tracking-tighter">Live Updates</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 p-4 max-h-[300px] overflow-y-auto custom-scrollbar space-y-4">
                      {!reviewsData || reviewsData.loading ? (
                        <div className="flex flex-col items-center justify-center py-12 opacity-30 gap-2"><RefreshCw className="animate-spin" size={18} /><p className="text-[9px] uppercase tracking-widest">กำลังดึงข้อมูล...</p></div>
                      ) : reviewsData?.error ? (
                        <div className="text-center py-12 opacity-40 italic text-[11px]">{reviewsData.error}</div>
                      ) : Array.isArray(reviewsData?.reviews) && reviewsData.reviews.length === 0 ? (
                        <div className="text-center py-12 opacity-30 italic text-[11px]">ไม่พบรีวิว</div>
                      ) : reviewsData?.reviews ? reviewsData.reviews.map((rev: any, idx: number) => (
                        <div key={idx} className="bg-black/20 p-3 rounded-lg border border-white/5 space-y-2">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-1.5">
                              {rev.voted_up ? (
                                <div className="p-1 bg-blue-500/20 rounded text-blue-400"><TrendingUp size={12} /></div>
                              ) : (
                                <div className="p-1 bg-red-500/20 rounded text-red-400"><TrendingUp size={12} className="rotate-180" /></div>
                              )}
                              <span className={`text-[10px] font-bold ${rev.voted_up ? 'text-blue-400' : 'text-red-400'}`}>{rev.voted_up ? 'แนะนำ' : 'ไม่แนะนำ'}</span>
                            </div>

                            <div className="flex items-center gap-2">
                              {rev.author_avatar ? (
                                <img src={rev.author_avatar} alt="avatar" className="w-5 h-5 rounded-full border border-white/10" />
                              ) : (
                                <div className="w-5 h-5 rounded-full bg-white/5 border border-white/10" />
                              )}
                              {rev.author_profileurl ? (
                                <a href={rev.author_profileurl} target="_blank" rel="noreferrer" className="text-[9px] text-[#66c0f4] hover:underline">
                                  {rev.author_name || (rev.author ? `${rev.author.substring(0, 8)}...` : 'Unknown')}
                                </a>
                              ) : (
                                <span className="text-[9px] opacity-60">
                                  {rev.author_name || (rev.author ? `${rev.author.substring(0, 8)}...` : 'Unknown')}
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-[11px] text-[#c7d5e0]/80 italic line-clamp-3 leading-relaxed">"{rev.review_text}"</p>
                          <div className="flex justify-between items-center pt-1 border-t border-white/5"><span className="text-[9px] opacity-40">มีประโยชน์: {rev.votes_up} คน</span><button onClick={() => fetchGameDetail(game.appid)} className="text-[9px] text-[#66c0f4] hover:underline">อ่านเพิ่มเติม</button></div>
                        </div>
                      )) : <div className="text-center py-12 opacity-20 italic text-[11px]">กำลังเตรียมข้อมูล...</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'friends' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1"><div className="glass-card rounded-2xl p-5 text-white h-[600px] flex flex-col"><h3 className="text-lg font-bold mb-4 flex items-center gap-2 border-b border-[#66c0f4]/20 pb-3"><Users size={18} className="text-[#66c0f4]" />เพื่อนใน Steam ({userFriends.length})</h3><div className="flex-1 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
            {loadingFriends ? <div className="flex flex-col items-center justify-center h-40 opacity-40"><RefreshCw className="animate-spin mb-2" size={20} /><p className="text-[10px]">กำลังโหลด...</p></div> : userFriends.length > 0 ? userFriends.map((friend) => (
              <div key={friend.steamid} onClick={() => fetchFriendStats(friend)} className="flex items-center gap-3 bg-white/5 p-2 rounded-lg border border-transparent hover:border-[#66c0f4]/30 hover:bg-white/10 transition-all group cursor-pointer"><div className="relative"><img src={friend.avatar} alt={friend.personaname} className="w-8 h-8 rounded-md" /><div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#171a21] ${friend.personastate === 1 ? 'bg-blue-400' : friend.personastate > 1 ? 'bg-green-400' : 'bg-gray-500'}`} /></div><div className="flex-1 min-w-0"><p className="text-xs font-bold truncate group-hover:text-[#66c0f4] transition-colors leading-tight">{friend.personaname}</p><p className="text-[9px] opacity-40 truncate">{friend.gameextrainfo ? <span className="text-green-400 font-medium">เล่นอยู่: {friend.gameextrainfo}</span> : (friend.personastate === 1 ? 'ออนไลน์' : 'ออฟไลน์')}</p></div></div>
            )) : <div className="text-center py-12 opacity-30 italic text-xs">{user ? 'ไม่พบรายชื่อเพื่อน' : 'กรุณาเข้าสู่ระบบ'}</div>}
          </div></div></div>
          <div className="lg:col-span-2 space-y-6"><div className="glass-card rounded-2xl p-8 text-center space-y-6"><div className="inline-flex p-4 bg-[#66c0f4]/10 rounded-full text-[#66c0f4] mb-4"><Search size={48} /></div><h2 className="text-3xl font-bold text-white">ค้นหาเพื่อนคนอื่นๆ</h2><p className="text-[#c7d5e0]/60 max-w-md mx-auto text-sm">ระบุ **SteamID64** หรือ **ชื่อใน URL** เพื่อค้นหาโปรไฟล์อื่นๆ</p><div className="flex gap-2 max-w-lg mx-auto"><input type="text" value={friendSearchQuery} onChange={(e) => setFriendSearchQuery(e.target.value)} placeholder="ค้นหาด้วย SteamID หรือชื่อโปรไฟล์..." className="flex-1 bg-[#1b2838] border border-[#66c0f4]/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#66c0f4] transition-all" onKeyDown={(e) => { if (e.key === 'Enter') handleFriendSearch(); }} /><button onClick={handleFriendSearch} disabled={isSearching} className="bg-[#66c0f4] text-[#171a21] px-6 py-3 rounded-lg font-bold hover:shadow-glow transition-all disabled:opacity-50">{isSearching ? '...' : 'ค้นหา'}</button></div></div></div>
        </div>
      )}

      <AnimatePresence>
        {selectedFriend && friendStats && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-[#171a21] border border-[#66c0f4]/30 w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl shadow-2xl relative text-white p-8">
              <button onClick={() => setSelectedFriend(null)} className="absolute top-4 right-4 text-white/50 hover:text-white z-10 bg-black/20 p-2 rounded-full"><X size={24} /></button>
              <div className="flex items-center gap-6 mb-8"><img src={selectedFriend.avatarfull} alt={selectedFriend.personaname} className="w-20 h-20 rounded-xl border-2 border-[#66c0f4]" /><div><h2 className="text-3xl font-bold">{selectedFriend.personaname}</h2><p className="text-[#66c0f4] flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${selectedFriend.personastate === 1 ? 'bg-blue-400' : selectedFriend.personastate > 1 ? 'bg-green-400' : 'bg-gray-500'}`} />{selectedFriend.gameextrainfo ? `กำลังเล่น: ${selectedFriend.gameextrainfo}` : (selectedFriend.personastate === 1 ? 'ออนไลน์' : 'ออฟไลน์')}</p></div></div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"><div className="bg-[#1b2838] p-4 rounded-xl border border-white/5 text-center"><p className="text-[10px] uppercase opacity-40 mb-1">ชั่วโมงเล่นทั้งหมด</p><p className="text-xl font-bold text-[#66c0f4]">{friendStats.total_playtime_hours.toLocaleString()} ชม.</p></div><div className="bg-[#1b2838] p-4 rounded-xl border border-white/5 text-center"><p className="text-[10px] uppercase opacity-40 mb-1">เกมที่มี</p><p className="text-xl font-bold text-purple-400">{friendStats.games_count}</p></div><div className="bg-[#1b2838] p-4 rounded-xl border border-white/5 text-center"><p className="text-[10px] uppercase opacity-40 mb-1">เกมที่เคยเล่น</p><p className="text-xl font-bold text-green-400">{friendStats.games_played}</p></div></div>
              <h3 className="text-lg font-bold mb-4 border-b border-white/10 pb-2">เกมที่เล่นบ่อยที่สุด</h3>
              <div className="space-y-3">{friendStats.top_played.map((game) => (
                <div key={game.appid} className="flex items-center gap-4 bg-white/5 p-3 rounded-lg border border-white/5"><img src={`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appid}/header.jpg`} alt={game.name} className="w-20 h-10 object-cover rounded shadow-md" /><div className="flex-1 min-w-0"><h4 className="font-bold truncate text-sm">{game.name}</h4><p className="text-xs text-[#66c0f4] font-mono">{Math.round(game.playtime_forever / 60)} ชม.</p></div></div>
              ))}</div>
              <div className="mt-8 text-center"><button onClick={() => setSelectedFriend(null)} className="px-8 py-2 bg-[#2a475e] hover:bg-[#66c0f4] hover:text-[#171a21] rounded-full font-bold transition-all text-sm">ปิด</button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedGame && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-[#171a21] border border-[#66c0f4]/30 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl relative text-white p-8">
              <button onClick={() => setSelectedGame(null)} className="absolute top-4 right-4 text-white/50 hover:text-white z-10 bg-black/20 p-2 rounded-full transition-colors"><X size={24} /></button>
              <div className="flex items-center gap-4 mb-8 border-b border-white/10 pb-4"><img src={selectedGame.header_image} alt={selectedGame.name} className="w-24 h-12 object-cover rounded-lg border border-white/10" /><div><h2 className="text-2xl font-bold leading-tight">{selectedGame.name}</h2><div className="flex gap-2 mt-1"><button onClick={() => setShowStatsOnly(false)} className={`text-xs px-3 py-1 rounded-full transition-all ${!showStatsOnly ? 'bg-[#66c0f4] text-[#171a21] font-bold' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}>ℹ️ ข้อมูลเกม</button><button onClick={() => setShowStatsOnly(true)} className={`text-xs px-3 py-1 rounded-full transition-all ${showStatsOnly ? 'bg-green-500 text-white font-bold' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}>📈 สถิติเชิงลึก</button></div></div></div>
              {showStatsOnly ? (
                <div className="space-y-10">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4"><div className="bg-[#1b2838] p-4 rounded-xl border border-white/5 flex flex-col justify-center items-center"><Users className="text-[#66c0f4] mb-2" size={24} /><p className="text-[10px] uppercase opacity-40">ผู้เล่นปัจจุบัน</p><p className="text-xl font-bold">{selectedGame.current_players.toLocaleString()}</p></div><div className="bg-[#1b2838] p-4 rounded-xl border border-white/5 flex flex-col justify-center items-center"><TrendingUp className="text-green-400 mb-2" size={24} /><p className="text-[10px] uppercase opacity-40">ความสำเร็จ</p><p className="text-xl font-bold">{selectedGame.achievement_count}</p></div><div className="bg-[#1b2838] p-4 rounded-xl border border-white/5 flex flex-col justify-center items-center text-center"><Clock className="text-purple-400 mb-2" size={24} /><p className="text-[10px] uppercase opacity-40">DLC ทั้งหมด</p><p className="text-xl font-bold">{selectedGame.dlc_count}</p></div><div className="bg-[#1b2838] p-4 rounded-xl border border-white/5 flex flex-col justify-center items-center"><ShieldCheck className="text-yellow-400 mb-2" size={24} /><p className="text-[10px] uppercase opacity-40">ราคา</p><p className="text-xl font-bold text-green-400">{selectedGame.price?.final_formatted || 'Free'}</p></div></div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="glass-card p-6 rounded-2xl border border-white/5 h-[300px] flex flex-col"><h3 className="text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-[#66c0f4]" />แนวโน้มจำนวนผู้เล่น (24 ชม.)</h3><div className="flex-1 min-h-0"><Line data={{ labels: ['4 ชม.', '3 ชม.', '2 ชม.', '1 ชม.', 'ตอนนี้'], datasets: [{ label: 'ผู้เล่น', data: selectedGame.player_history, borderColor: '#66c0f4', backgroundColor: 'rgba(102, 192, 244, 0.2)', fill: true, tension: 0.4 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#66c0f4', font: { size: 10 } } }, x: { grid: { display: false }, ticks: { color: '#c7d5e0', font: { size: 10 } } } } }} /></div></div>
                    <div className="glass-card p-6 rounded-2xl border border-white/5 h-[300px] flex flex-col"><h3 className="text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2 text-green-400"><ShieldCheck size={16} />เปรียบเทียบสถิติเกม</h3><div className="flex-1 min-h-0"><Bar data={{ labels: ['DLC', 'Achievements', 'Players (k)'], datasets: [{ label: 'จำนวน', data: [selectedGame.dlc_count, selectedGame.achievement_count, selectedGame.current_players / 1000], backgroundColor: ['rgba(168, 85, 247, 0.6)', 'rgba(34, 197, 94, 0.6)', 'rgba(102, 192, 244, 0.6)'], borderRadius: 8 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#ffffff', font: { size: 10 } } }, x: { grid: { display: false }, ticks: { color: '#ffffff', font: { size: 10 } } } } }} /></div></div>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                      <section><h3 className="text-sm font-bold uppercase tracking-widest text-[#66c0f4] mb-3">เกี่ยวกับเกม</h3><div className="text-[#c7d5e0]/80 leading-relaxed text-sm prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: selectedGame.description }} /></section>
                      <section><h3 className="text-sm font-bold uppercase tracking-widest text-green-400 mb-4">ความสำเร็จ (Icon Grid)</h3><div className="grid grid-cols-6 sm:grid-cols-10 gap-2">{selectedGame.achievements.slice(0, 30).map((ach, idx) => (<div key={idx} className={`aspect-square p-1 rounded-md border border-white/5 ${ach.unlocked ? 'bg-green-500/10' : 'bg-black/40 opacity-30'}`} title={ach.displayName}><img src={ach.icon} alt="ach" className={`w-full h-full rounded ${ach.unlocked ? 'grayscale-0' : 'grayscale'}`} /></div>))}</div></section>
                    </div>
                    <div className="space-y-6">
                      <div className="bg-[#1b2838] p-6 rounded-2xl border border-white/5"><h4 className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-4">ข้อมูลเบื้องต้น</h4><div className="space-y-4"><div className="flex justify-between border-b border-white/5 pb-2"><span className="text-xs opacity-50">วันวางจำหน่าย</span><span className="text-xs font-bold">{selectedGame.release_date}</span></div><div className="flex justify-between border-b border-white/5 pb-2"><span className="text-xs opacity-50">ผู้พัฒนา</span><span className="text-xs font-bold text-right">{selectedGame.developers.join(', ')}</span></div><div className="flex justify-between border-b border-white/5 pb-2"><span className="text-xs opacity-50">ผู้จัดจำหน่าย</span><span className="text-xs font-bold text-right">{selectedGame.publishers.join(', ')}</span></div><div className="flex justify-between"><span className="text-xs opacity-50">ราคาปัจจุบัน</span><span className="text-sm font-bold text-green-400">{selectedGame.price?.final_formatted || 'Free'}</span></div></div></div>
                      <a href={`https://store.steampowered.com/app/${selectedGame.appid}`} target="_blank" rel="noreferrer" className="w-full py-3 bg-[#66c0f4] text-[#171a21] rounded-xl font-bold hover:shadow-glow transition-all flex items-center justify-center gap-2 text-sm"><Gamepad2 size={18} /> ซื้อเลยบน Steam</a>
                    </div>
                  </div>
                </div>
              )}
              <div className="mt-10 pt-6 border-t border-white/5 text-center"><button onClick={() => setSelectedGame(null)} className="px-12 py-2.5 bg-[#2a475e] text-white rounded-full font-bold hover:bg-[#345678] transition-all text-sm">ปิดหน้าต่าง</button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {loadingDetail && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
          <RefreshCw className="text-[#66c0f4] animate-spin" size={48} />
        </div>
      )}
    </div>
  );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
  <button onClick={onClick} className={`px-4 py-2 font-bold transition-all border-b-2 ${active ? 'border-[#66c0f4] text-[#66c0f4]' : 'border-transparent opacity-50 hover:opacity-80'}`}>{label}</button>
);

const AnimatedPath: React.FC<{ d: string }> = ({ d }) => (
  <>
    <path d={d} fill="none" stroke="url(#lineGrad)" strokeWidth="3.5" strokeLinecap="round" opacity="0.7" markerEnd="url(#arrowhead)" />
    <path d={d} fill="none" stroke="#66c0f4" strokeWidth="3.5" strokeDasharray="12,24" strokeLinecap="round">
      <animate attributeName="stroke-dashoffset" from="480" to="0" dur="2.5s" repeatCount="indefinite" />
    </path>
  </>
);

const TechBadge: React.FC<{ label: string }> = ({ label }) => (
  <span className="px-3 py-1 bg-white/5 rounded-full text-[10px] border border-white/10 text-purple-300 font-bold uppercase tracking-tighter">
    {label}
  </span>
);

const DiagramNode: React.FC<{ title: string; items: string[]; color: string; borderColor: string }> = ({ title, items, color, borderColor }) => (
  <motion.div whileHover={{ y: -5 }} className={`${color} border ${borderColor} p-6 rounded-2xl w-[280px] text-center`}>
    <h4 className="font-bold text-white mb-3 border-b border-white/10 pb-2">{title}</h4>
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <span key={i} className="bg-white/10 px-3 py-1.5 rounded-lg text-xs font-mono">{item}</span>
      ))}
    </div>
  </motion.div>
);

const StorageNode: React.FC<{ title: string; sub: string; type: string }> = ({ title, sub, type }) => (
  <div className="flex flex-col items-center gap-2 group">
    <motion.div 
      whileHover={{ scale: 1.05, y: -5 }}
      className={`w-36 h-24 border-2 rounded-2xl flex flex-col items-center justify-center relative transition-all shadow-lg ${
        type === 'avro' ? 'border-green-500/50 bg-green-500/10 shadow-green-500/5' : 
        type === 'parquet' ? 'border-cyan-400/50 bg-cyan-400/10 shadow-cyan-400/5' : 
        'border-yellow-400/50 bg-yellow-400/10 shadow-yellow-400/5'
      }`}
    >
      <div className={`absolute -top-2 px-2 py-0.5 rounded text-[8px] font-black uppercase ${
        type === 'avro' ? 'bg-green-500 text-black' : 
        type === 'parquet' ? 'bg-cyan-400 text-black' : 
        'bg-yellow-400 text-black'
      }`}>
        {type}
      </div>
      <span className="text-xs font-black text-white mb-1 uppercase tracking-tighter">{title}</span>
      <span className="text-[9px] opacity-60 text-center px-2 font-mono">{sub}</span>
    </motion.div>
    <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">{type} Storage</span>
  </div>
);

const ApiEndpoint: React.FC<{ method: string; path: string; desc: string }> = ({ method, path, desc }) => (
  <div className="bg-black/40 border border-white/5 p-4 rounded-xl hover:border-green-400/30 transition-colors">
    <div className="flex items-center gap-2 mb-2">
      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${method === 'GET' ? 'bg-purple-500/20 text-purple-400' : 'bg-green-500/20 text-green-400'}`}>
        {method}
      </span>
      <span className="text-[10px] font-mono opacity-80 truncate">{path}</span>
    </div>
    <div className="text-[10px] font-bold text-[#66c0f4] uppercase tracking-widest">{desc}</div>
  </div>
);

const GameRow: React.FC<{ game: Game; index: number; onSelect: (appid: number) => void }> = ({ game, index, onSelect }) => {
  const [sentiment, setSentiment] = useState<any>(null);
  useEffect(() => { fetch(`/api/games/sentiment/${game.appid}`).then(res => res.json()).then(data => setSentiment(data)); }, [game.appid]);
  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.1 }} className="flex items-center gap-4 bg-[#171a21]/50 p-3 rounded-lg border border-[#66c0f4]/10 hover:border-[#66c0f4]/30 transition-colors cursor-pointer" onClick={() => onSelect(game.appid)}>
      <img src={game.header_image} alt={game.name} className="w-24 h-12 object-cover rounded shadow-lg" />
      <div className="flex-1 min-w-0"><h4 className="font-bold truncate text-white">{game.name}</h4><div className="flex items-center gap-2"><p className="text-sm opacity-60">{game.genre}</p>{sentiment && <span className={`text-[10px] px-1.5 rounded uppercase font-bold ${sentiment.color === 'green' ? 'bg-green-500/20 text-green-400' : sentiment.color === 'red' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{sentiment.label}</span>}</div></div>
      <div className="text-right"><div className="font-mono text-[#66c0f4] font-bold">{game.current_players?.toLocaleString()}</div><p className="text-xs opacity-50 uppercase tracking-tighter">ผู้เล่น</p></div>
    </motion.div>
  );
};

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string; trend: string }> = ({ icon, label, value, trend }) => (
  <motion.div whileHover={{ y: -4 }} className="glass-card p-6 rounded-xl shadow-lg relative overflow-hidden group">
    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">{React.cloneElement(icon as React.ReactElement, { size: '64' } as any)}</div>
    <div className="flex items-center gap-3 mb-4">{icon}<span className="text-[#c7d5e0] opacity-70 font-medium uppercase tracking-wider text-sm">{label}</span></div>
    <div className="text-3xl font-bold text-white mb-2">{value}</div>
    <div className="text-xs text-[#66c0f4] opacity-80">{trend}</div>
  </motion.div>
);

const MarketStat: React.FC<{ icon: React.ReactNode; label: string; value: string; showProgress?: boolean; progressValue?: number }> = ({ icon, label, value, showProgress, progressValue }) => (
  <div className="space-y-2">
    <div className="flex justify-between items-center text-white"><div className="flex items-center gap-2 text-[#c7d5e0]/70"><span className="text-[#66c0f4]">{icon}</span><span className="text-sm font-medium">{label}</span></div><span className="font-mono font-bold">{value}</span></div>
    {showProgress && <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${progressValue}%` }} transition={{ duration: 1, ease: "easeOut" }} className={`h-full rounded-full ${progressValue && progressValue > 80 ? 'bg-green-500' : 'bg-[#66c0f4]'}`} /></div>}
  </div>
);

export default App;
