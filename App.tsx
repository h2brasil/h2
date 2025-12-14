import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Navigation, Loader2, RotateCcw, Crosshair, MapPin, Package, Calendar, Clock, History, CheckSquare, X, MessageSquare, Lock, User, LogOut, Truck, AlertTriangle, Wifi, Map as MapIcon, Settings, UserCircle, KeyRound, ArrowRight } from 'lucide-react';
import { ITAJAI_UBS_LIST } from './constants';
import { UBS, Coordinates, OptimizationResult, ViewState, DeliveryHistoryItem, ActiveDriver } from './types';
import MapComponent from './components/Map';
import { optimizeRoute } from './services/geminiService';

// Firebase Imports - Modular Syntax
// @ts-ignore
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, set, onValue, push, onDisconnect, remove, update, get } from "firebase/database";

// --- CONFIGURAÇÃO DO FIREBASE (H2 BRASIL LOGÍSTICA) ---
const firebaseConfig = {
  apiKey: "AIzaSyC9sZkmfI_F32inTsH5nPloQu_PYD4Ix3A",
  authDomain: "h2brasil-logistica.firebaseapp.com",
  databaseURL: "https://h2brasil-logistica-default-rtdb.firebaseio.com",
  projectId: "h2brasil-logistica",
  storageBucket: "h2brasil-logistica.firebasestorage.app",
  messagingSenderId: "4439234426",
  appId: "1:4439234426:web:f27b403dd49bee7a3828c3",
  measurementId: "G-6M2EGP7TDD"
};

// Inicializa o Firebase
let app;
let db: any = null;
let firebaseErrorMsg = "";

try {
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApp();
  }
  db = getDatabase(app);
} catch (error: any) {
  console.error("Erro crítico ao inicializar Firebase:", error);
  firebaseErrorMsg = "Erro de conexão com o Banco de Dados. Verifique sua internet.";
}

// Logo Component
const H2Logo = () => (
  <svg viewBox="0 0 100 100" className="h-10 w-10 md:h-12 md:w-12 mr-3 drop-shadow-sm" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 5 C50 5 10 45 10 65 C10 87 28 100 50 100 C72 100 90 87 90 65 C90 45 50 5 50 5Z" fill="white"/>
    <path d="M50 5 C50 5 15 42 12 60 C12 60 20 80 50 80 C40 60 50 5 50 5Z" fill="#166534" /> 
    <path d="M50 100 C72 100 90 87 90 65 C90 50 70 25 50 5 C55 30 60 60 30 85 C35 95 42 100 50 100Z" fill="#EAB308" />
    <circle cx="50" cy="65" r="18" fill="#003366" />
    <path d="M50 55 L53 60 H47 Z" fill="white" />
    <path d="M45 65 L48 70 H42 Z" fill="white" />
    <path d="M55 65 L58 70 H52 Z" fill="white" />
  </svg>
);

export default function App() {
  // App State
  const [viewState, setViewState] = useState<ViewState>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(firebaseErrorMsg || null);

  // Driver / User State
  const [driverName, setDriverName] = useState('');
  const [driverId, setDriverId] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<'locating' | 'found' | 'error'>('locating');

  // Route State
  const [selectedUBS, setSelectedUBS] = useState<string[]>([]);
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);

  // Admin State
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [activeDrivers, setActiveDrivers] = useState<ActiveDriver[]>([]);
  
  // History
  const [history, setHistory] = useState<DeliveryHistoryItem[]>([]);
  const [historyDateFilter, setHistoryDateFilter] = useState<string>(new Date().toISOString().split('T')[0]);

  // UI State
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; stopId: string | null }>({ isOpen: false, stopId: null });
  const [noteText, setNoteText] = useState('');
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  // --- EFEITOS DE INICIALIZAÇÃO ---

  // 1. Recuperar Sessão do Motorista (Persistência)
  useEffect(() => {
    const storedDriverId = localStorage.getItem('h2_driver_id');
    const storedDriverName = localStorage.getItem('h2_driver_name');

    if (storedDriverId && !isAdmin) {
        setDriverId(storedDriverId);
        if (storedDriverName) setDriverName(storedDriverName);
        
        // Pula tela de login se já tem ID
        setViewState('selection');

        // Sincroniza nome atualizado do banco se disponível
        if (db) {
            get(ref(db, `drivers/${storedDriverId}/name`)).then((snapshot) => {
                if (snapshot.exists()) {
                    setDriverName(snapshot.val());
                    localStorage.setItem('h2_driver_name', snapshot.val());
                }
            }).catch(console.error);
        }
        
        // Inicia GPS imediatamente
        getLocation();
    }
  }, [isAdmin]);

  // 2. Carregar Histórico Global (Firebase)
  useEffect(() => {
    if (!db) return;
    const historyRef = ref(db, 'history');
    const unsubscribe = onValue(historyRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const historyArray = Object.values(data) as DeliveryHistoryItem[];
        setHistory(historyArray.sort((a, b) => (b.date + b.completedAt).localeCompare(a.date + a.completedAt)));
      } else {
        setHistory([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // 3. Monitoramento de Motoristas (Apenas para Admin)
  useEffect(() => {
    if (isAdmin && viewState === 'admin-monitor' && db) {
      const driversRef = ref(db, 'drivers');
      const unsubscribe = onValue(driversRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const driversList = Object.values(data) as ActiveDriver[];
          // Filtra quem não atualiza há mais de 24h para limpar o mapa visualmente
          const oneDayAgo = Date.now() - 86400000;
          setActiveDrivers(driversList.filter(d => d.updatedAt > oneDayAgo));
        } else {
          setActiveDrivers([]);
        }
      });
      return () => unsubscribe();
    }
  }, [isAdmin, viewState]);

  // 4. Rastreamento GPS e Sync (Apenas Motorista Logado)
  useEffect(() => {
    let watchId: number;

    if (!isAdmin && driverId && navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setCurrentLocation({ lat: latitude, lng: longitude });
          setLocationStatus('found');

          // Atualiza Firebase
          if (db) {
            const myDriverRef = ref(db, `drivers/${driverId}`);
            
            // Configura desconexão automática (fica 'offline' se fechar o app)
            onDisconnect(myDriverRef).update({ 
              status: 'offline',
              updatedAt: Date.now() 
            });

            update(myDriverRef, {
              id: driverId,
              name: driverName,
              lat: latitude,
              lng: longitude,
              updatedAt: Date.now(),
              status: 'online'
            });
          }
        },
        (err) => {
          console.error("Erro GPS:", err);
          setLocationStatus('error');
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
      );
    }

    return () => {
      if (watchId) navigator.geolocation.clearWatch(watchId);
    };
  }, [isAdmin, driverId, driverName]);


  // --- FUNÇÕES DE AÇÃO ---

  const handleDriverLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!driverName.trim()) return;

    // Sanitiza o nome para usar como ID único
    const id = driverName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Salva sessão localmente para persistência
    localStorage.setItem('h2_driver_id', id);
    localStorage.setItem('h2_driver_name', driverName);

    setDriverId(id);
    setViewState('selection');
    getLocation();
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPassword === 'lulaladrao') {
        setIsAdmin(true);
        setViewState('admin-monitor');
        setShowAdminLogin(false);
        setAdminPassword('');
    } else {
        setError('Senha administrativa incorreta.');
        setTimeout(() => setError(null), 3000);
    }
  };

  const logout = () => {
    if (isAdmin) {
        setIsAdmin(false);
        setViewState('login');
    } else {
        // Se for motorista, muda status para offline antes de sair
        if (db && driverId) {
            update(ref(db, `drivers/${driverId}`), { status: 'offline' });
        }
        // Limpa sessão persistente
        localStorage.removeItem('h2_driver_id');
        localStorage.removeItem('h2_driver_name');

        setDriverId(null);
        setDriverName('');
        setViewState('login');
        setSelectedUBS([]);
        setOptimizationResult(null);
    }
  };

  const getLocation = () => {
    setLocationStatus('locating');
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocationStatus('found');
        },
        () => {
           setCurrentLocation({ lat: -26.9046, lng: -48.6612 }); // Fallback
           setLocationStatus('error');
        }
      );
    }
  };

  const toggleUBS = (id: string) => {
    setSelectedUBS(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const selectAll = () => {
      setSelectedUBS(selectedUBS.length === ITAJAI_UBS_LIST.length ? [] : ITAJAI_UBS_LIST.map(u => u.id));
  };

  const handleOptimization = async () => {
    if (selectedUBS.length === 0) return setError("Selecione entregas.");
    if (!currentLocation) {
        getLocation();
        return setError("Aguardando GPS...");
    }

    setLoading(true);
    setViewState('optimizing');
    
    try {
      const selectedData = ITAJAI_UBS_LIST.filter(u => selectedUBS.includes(u.id));
      const result = await optimizeRoute(currentLocation, selectedData);
      setOptimizationResult(result);
      setViewState('result');
      
      if (db && driverId) {
          update(ref(db, `drivers/${driverId}`), { currentDestination: 'Em rota de entrega' });
      }

    } catch (e: any) {
      setError(e.message || "Erro ao calcular rota.");
      setViewState('selection');
    } finally {
      setLoading(false);
    }
  };

  const handleNavigateAll = () => {
    if (!currentLocation || !optimizationResult) return;
    const pending = optimizationResult.route.filter(s => s.status !== 'completed');
    if (pending.length === 0) return alert("Rota finalizada!");

    const origin = `${currentLocation.lat},${currentLocation.lng}`;
    const dest = pending[pending.length - 1];
    const waypoints = pending.slice(0, pending.length - 1).map(s => `${s.coords.lat},${s.coords.lng}`).join('|');
    
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest.coords.lat},${dest.coords.lng}&waypoints=${waypoints}`, '_blank');
  };

  const handleConfirmDelivery = () => {
    if (!optimizationResult || !confirmModal.stopId) return;

    const stopId = confirmModal.stopId;
    const now = new Date();
    const timestamp = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dateKey = now.toISOString().split('T')[0];
    const stopDetails = optimizationResult.route.find(s => s.id === stopId);

    // Update Local State
    const updatedRoute = optimizationResult.route.map(stop => 
        stop.id === stopId ? { ...stop, status: 'completed' as const, completedAt: timestamp, notes: noteText } : stop
    );
    setOptimizationResult({ ...optimizationResult, route: updatedRoute });

    // Update Firebase
    if (stopDetails && db) {
        const item: DeliveryHistoryItem = {
            id: `${stopId}-${now.getTime()}`,
            stopName: stopDetails.name,
            address: stopDetails.address,
            completedAt: timestamp,
            date: dateKey,
            notes: noteText
        };
        push(ref(db, 'history'), item);
    }
    setConfirmModal({ isOpen: false, stopId: null });
  };

  // --- RENDERIZADORES ---

  if (error && error.includes("Banco de Dados")) {
      return (
          <div className="h-screen flex flex-col items-center justify-center bg-red-50 p-6 text-center">
              <AlertTriangle className="h-12 w-12 text-red-600 mb-4" />
              <h1 className="text-xl font-bold text-red-900">Serviço Indisponível</h1>
              <p className="text-red-700 mt-2">{error}</p>
              <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-red-600 text-white rounded">
                  Tentar Novamente
              </button>
          </div>
      );
  }

  // TELA DE LOGIN (INICIAL)
  if (viewState === 'login') {
      return (
        <div className="h-screen bg-[#002855] flex flex-col items-center justify-center p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                <div className="absolute top-10 left-10 w-64 h-64 bg-[#FBBF24] rounded-full blur-3xl"></div>
                <div className="absolute bottom-10 right-10 w-96 h-96 bg-blue-400 rounded-full blur-3xl"></div>
            </div>

            <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-8 rounded-2xl w-full max-w-md shadow-2xl z-10">
                <div className="flex flex-col items-center mb-8">
                    <H2Logo />
                    <h1 className="text-2xl font-bold text-white mt-4 tracking-tight">H2 BRASIL <span className="text-[#FBBF24]">LOGÍSTICA</span></h1>
                    <p className="text-blue-200 text-sm mt-1">Sistema de Roteirização Inteligente</p>
                </div>

                {!showAdminLogin ? (
                    <form onSubmit={handleDriverLogin} className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-blue-200 uppercase tracking-wider mb-2 block">Identificação do Motorista</label>
                            <div className="relative group">
                                <UserCircle className="absolute left-3 top-3.5 h-5 w-5 text-slate-400 group-focus-within:text-[#FBBF24] transition-colors" />
                                <input 
                                    type="text" 
                                    value={driverName}
                                    onChange={(e) => setDriverName(e.target.value)}
                                    className="w-full bg-white/10 border border-white/20 text-white pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FBBF24] placeholder-blue-300/50"
                                    placeholder="Digite seu Nome ou Placa"
                                    required
                                />
                            </div>
                        </div>
                        <button type="submit" className="w-full bg-[#FBBF24] hover:bg-[#d9a51f] text-[#002855] font-bold py-3.5 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 group">
                            INICIAR TURNO <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                        </button>
                        <div className="pt-4 text-center">
                            <button type="button" onClick={() => setShowAdminLogin(true)} className="text-xs text-blue-300 hover:text-white underline decoration-dashed underline-offset-4">
                                Acesso Administrativo
                            </button>
                        </div>
                    </form>
                ) : (
                    <form onSubmit={handleAdminLogin} className="space-y-4 animate-in fade-in slide-in-from-right-10 duration-300">
                         <div>
                            <label className="text-xs font-bold text-blue-200 uppercase tracking-wider mb-2 block">Senha Master</label>
                            <div className="relative group">
                                <KeyRound className="absolute left-3 top-3.5 h-5 w-5 text-slate-400 group-focus-within:text-[#FBBF24] transition-colors" />
                                <input 
                                    type="password" 
                                    value={adminPassword}
                                    onChange={(e) => setAdminPassword(e.target.value)}
                                    className="w-full bg-white/10 border border-white/20 text-white pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FBBF24] placeholder-blue-300/50"
                                    placeholder="Senha de Gestor"
                                    autoFocus
                                />
                            </div>
                        </div>
                        {error && <p className="text-red-400 text-xs text-center">{error}</p>}
                        <div className="flex gap-3">
                            <button type="button" onClick={() => setShowAdminLogin(false)} className="flex-1 bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl transition-colors">
                                Voltar
                            </button>
                            <button type="submit" className="flex-1 bg-[#FBBF24] hover:bg-[#d9a51f] text-[#002855] font-bold py-3 rounded-xl transition-colors shadow-lg">
                                Entrar
                            </button>
                        </div>
                    </form>
                )}
            </div>
            <p className="absolute bottom-4 text-[10px] text-white/30">v2.1 • Powered by Gemini AI & Firebase</p>
        </div>
      );
  }

  // APP PRINCIPAL
  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden font-sans">
      
      {/* Header Profissional */}
      <header className="bg-[#002855] text-white px-4 py-3 shadow-lg flex items-center justify-between z-30 shrink-0">
        <div className="flex items-center gap-3">
           <H2Logo />
           <div className="flex flex-col">
              <span className="font-bold text-lg leading-tight tracking-tight">H2 BRASIL</span>
              <span className="text-[10px] text-blue-200 font-medium uppercase tracking-widest">
                  {isAdmin ? 'Painel de Gestão' : 'Logística Mobile'}
              </span>
           </div>
        </div>

        <div className="flex items-center gap-3">
             {isAdmin ? (
                 <div className="flex items-center bg-blue-900/50 px-3 py-1.5 rounded-lg border border-blue-800">
                     <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse mr-2"></span>
                     <span className="text-xs font-bold text-blue-100 hidden md:inline">MONITORAMENTO ATIVO</span>
                     <span className="text-xs font-bold text-blue-100 md:hidden">ADMIN</span>
                 </div>
             ) : (
                 <div className="flex items-center gap-2 text-right">
                     <div className="flex flex-col items-end">
                         <span className="text-xs font-bold text-white">{driverName}</span>
                         <span className="text-[9px] text-green-400 font-bold flex items-center gap-1">
                             <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div> ONLINE
                         </span>
                     </div>
                 </div>
             )}
             
             <button onClick={logout} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors ml-2">
                 <LogOut className="h-5 w-5" />
             </button>
        </div>
      </header>

      {/* Layout Flexível */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        
        {/* SIDEBAR / PAINEL INFERIOR (Mobile) */}
        <div className={`
          z-20 bg-white shadow-xl transition-all duration-300 flex flex-col
          
          ${/* Mobile Styles */ ""}
          ${isAdmin && viewState === 'admin-monitor' 
             ? 'absolute bottom-0 w-full h-[40vh] rounded-t-2xl border-t border-slate-300' // Admin Mobile: 40% height
             : 'absolute bottom-0 w-full h-[60vh] rounded-t-2xl' // Driver Mobile: 60% height
           }

          ${/* Desktop Styles */ ""}
          md:relative md:w-[400px] md:h-full md:rounded-none md:border-r md:border-slate-200 md:inset-auto

          ${/* Hide sidebar when optimizing on mobile to show full loader */ ""}
          ${!isAdmin && viewState === 'optimizing' ? 'translate-y-full md:translate-x-0' : 'translate-y-0'}
        `}>
            
            {/* Header da Sidebar (Arrastável visualmente no mobile - Apenas Motorista) */}
            {!isAdmin && <div className="w-full h-1 bg-slate-200 md:hidden mx-auto mt-2 mb-1 w-12 rounded-full opacity-50"></div>}

            <div className="flex-1 relative overflow-hidden">
                
                {/* PAINEL SELEÇÃO (MOTORISTA) */}
                <div className={`absolute inset-0 flex flex-col transition-opacity duration-300 ${viewState === 'selection' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'}`}>
                    <div className="px-5 py-4 border-b border-slate-100 bg-white">
                        <h2 className="text-lg font-bold text-[#002855] flex items-center gap-2">
                            <Package className="h-5 w-5 text-[#FBBF24]" /> Seleção de Entregas
                        </h2>
                        <div className="flex justify-between items-center mt-2">
                            <span className="text-xs font-medium bg-slate-100 px-2 py-1 rounded text-slate-600">{selectedUBS.length} locais</span>
                            <button onClick={selectAll} className="text-xs font-bold text-[#002855] hover:underline">
                                {selectedUBS.length === ITAJAI_UBS_LIST.length ? 'Limpar' : 'Selecionar Todos'}
                            </button>
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-2 bg-slate-50 space-y-2">
                        {ITAJAI_UBS_LIST.map(ubs => (
                            <div key={ubs.id} onClick={() => toggleUBS(ubs.id)}
                                className={`p-3 rounded-lg border cursor-pointer flex items-center gap-3 transition-all ${selectedUBS.includes(ubs.id) ? 'bg-blue-50 border-[#002855]' : 'bg-white border-slate-200 hover:border-blue-300'}`}>
                                <div className={`w-5 h-5 rounded flex items-center justify-center border ${selectedUBS.includes(ubs.id) ? 'bg-[#002855] border-[#002855] text-white' : 'border-slate-300'}`}>
                                    {selectedUBS.includes(ubs.id) && <CheckCircle2 className="h-3.5 w-3.5" />}
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-800">{ubs.name}</h3>
                                    <p className="text-[10px] text-slate-500 truncate w-48">{ubs.address}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="p-4 bg-white border-t border-slate-200">
                        {error && <div className="text-red-500 text-xs text-center mb-2">{error}</div>}
                        <div className="flex gap-2">
                             <button onClick={() => setViewState('history')} className="px-4 py-3 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                                 <History className="h-5 w-5" />
                             </button>
                             <button onClick={handleOptimization} disabled={selectedUBS.length === 0} className="flex-1 bg-[#002855] text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 shadow-lg hover:bg-[#003366] disabled:opacity-50 disabled:cursor-not-allowed">
                                 <Navigation className="h-5 w-5 text-[#FBBF24]" /> OTIMIZAR ROTA
                             </button>
                        </div>
                    </div>
                </div>

                {/* PAINEL RESULTADO (MOTORISTA) */}
                <div className={`absolute inset-0 flex flex-col bg-white transition-opacity duration-300 ${viewState === 'result' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'}`}>
                     {optimizationResult && (
                         <>
                            <div className="p-4 bg-[#002855] text-white flex justify-between items-center shadow-md">
                                <div>
                                    <h2 className="font-bold text-lg flex items-center gap-2"><MapIcon className="h-5 w-5 text-[#FBBF24]"/> Rota Pronta</h2>
                                    <p className="text-xs text-blue-200">{optimizationResult.totalDistanceEst} • {optimizationResult.route.filter(s => s.status !== 'completed').length} pendentes</p>
                                </div>
                                <button onClick={() => { setViewState('selection'); setOptimizationResult(null); setSelectedUBS([]); }} className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded transition-colors">
                                    Nova Rota
                                </button>
                            </div>
                            
                            <div className="p-3 bg-blue-50 border-b border-blue-100 text-xs text-blue-800 italic">
                                "{optimizationResult.summary}"
                            </div>

                            <div className="flex-1 overflow-y-auto bg-slate-50 p-3 pb-20">
                                <button onClick={handleNavigateAll} className="w-full bg-[#FBBF24] text-[#002855] font-bold py-3 mb-4 rounded-lg shadow flex items-center justify-center gap-2 hover:brightness-105">
                                    <Navigation className="h-5 w-5" /> NAVEGAR ROTA COMPLETA
                                </button>
                                
                                <div className="space-y-4 pl-4 relative border-l-2 border-slate-300 ml-2">
                                    {optimizationResult.route.map((stop, idx) => (
                                        <div key={stop.id} className={`relative pl-6 ${stop.status === 'completed' ? 'opacity-50' : ''}`}>
                                            <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white shadow ${stop.status === 'completed' ? 'bg-green-500' : 'bg-[#002855]'}`}></div>
                                            <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                                                <div className="flex justify-between">
                                                    <span className="text-xs font-bold text-[#FBBF24] uppercase mb-1">Parada {stop.sequence}</span>
                                                    {stop.status === 'completed' && <span className="text-[10px] text-green-600 font-bold flex items-center gap-1"><CheckSquare className="h-3 w-3"/> Entregue {stop.completedAt}</span>}
                                                </div>
                                                <h3 className="font-bold text-slate-800 text-sm">{stop.name}</h3>
                                                <p className="text-xs text-slate-500 mb-3">{stop.address}</p>
                                                
                                                {stop.status !== 'completed' && (
                                                    <div className="flex gap-2">
                                                        <a href={`https://www.google.com/maps/dir/?api=1&destination=${stop.coords.lat},${stop.coords.lng}`} target="_blank" rel="noreferrer" 
                                                           className="flex-1 py-2 bg-slate-100 text-slate-600 text-xs font-bold rounded text-center hover:bg-slate-200">
                                                            Ver Mapa
                                                        </a>
                                                        <button onClick={() => setConfirmModal({isOpen: true, stopId: stop.id})} 
                                                                className="flex-1 py-2 bg-[#002855] text-white text-xs font-bold rounded hover:bg-[#003366]">
                                                            Confirmar
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                         </>
                     )}
                </div>

                {/* PAINEL ADMIN (GESTOR) */}
                <div className={`absolute inset-0 flex flex-col bg-slate-100 transition-opacity duration-300 ${viewState === 'admin-monitor' ? 'opacity-100 z-50' : 'opacity-0 pointer-events-none'}`}>
                     <div className="bg-white p-4 shadow-sm border-b border-slate-200 sticky top-0 z-10">
                         <h2 className="text-lg font-bold text-[#002855] flex items-center gap-2">
                             <Truck className="h-5 w-5 text-[#FBBF24]" /> Frota Online ({activeDrivers.length})
                         </h2>
                         <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                             <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-bold">
                                 {activeDrivers.filter(d => d.status === 'online').length} Online
                             </span>
                             <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded-full font-bold">
                                 {activeDrivers.filter(d => d.status !== 'online').length} Offline
                             </span>
                         </div>
                     </div>
                     
                     <div className="flex-1 overflow-y-auto p-3 space-y-3">
                         {activeDrivers.length === 0 ? (
                             <div className="text-center py-10 text-slate-400">
                                 <Wifi className="h-10 w-10 mx-auto mb-2 opacity-50"/>
                                 <p className="text-sm">Nenhum motorista conectado.</p>
                             </div>
                         ) : (
                             activeDrivers.map(driver => (
                                 <div key={driver.id} className={`bg-white p-3 rounded-lg border shadow-sm ${driver.status === 'online' ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-slate-300 opacity-70'}`}>
                                     <div className="flex justify-between items-start">
                                         <div>
                                             <h3 className="font-bold text-[#002855]">{driver.name}</h3>
                                             <p className="text-[10px] text-slate-400 uppercase tracking-wider">ID: {driver.id.substring(0,8)}</p>
                                         </div>
                                         <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${driver.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                             {driver.status}
                                         </div>
                                     </div>
                                     <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between items-center text-xs">
                                         <span className="text-slate-500">Último sinal: {new Date(driver.updatedAt).toLocaleTimeString()}</span>
                                         {driver.status === 'online' && <MapPin className="h-3 w-3 text-red-500" />}
                                     </div>
                                 </div>
                             ))
                         )}
                     </div>
                </div>

                {/* PAINEL HISTORICO */}
                <div className={`absolute inset-0 flex flex-col bg-white transition-opacity duration-300 ${viewState === 'history' ? 'opacity-100 z-20' : 'opacity-0 pointer-events-none'}`}>
                    <div className="p-4 bg-[#002855] text-white flex justify-between items-center">
                        <h2 className="font-bold flex items-center gap-2"><History className="h-5 w-5 text-[#FBBF24]"/> Histórico</h2>
                        <button onClick={() => setViewState(driverId ? 'selection' : 'login')} className="text-white hover:text-[#FBBF24]"><X className="h-6 w-6"/></button>
                    </div>
                    <div className="p-3 bg-slate-100 border-b">
                         <input type="date" value={historyDateFilter} onChange={e => setHistoryDateFilter(e.target.value)} className="w-full p-2 rounded border border-slate-300 text-sm"/>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50">
                        {history.filter(h => h.date === historyDateFilter).length === 0 ? (
                            <p className="text-center text-slate-400 text-sm mt-10">Nada registrado nesta data.</p>
                        ) : (
                            history.filter(h => h.date === historyDateFilter).map(h => (
                                <div key={h.id} className="bg-white p-3 rounded shadow-sm border border-slate-200">
                                    <div className="flex justify-between">
                                        <span className="font-bold text-[#002855] text-sm">{h.stopName}</span>
                                        <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">{h.completedAt}</span>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1">{h.address}</p>
                                    {h.notes && <div className="mt-2 bg-yellow-50 p-2 rounded text-[11px] text-yellow-800 italic">"{h.notes}"</div>}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            
            </div>
        </div>

        {/* MAP AREA - ALWAYS VISIBLE, FILLS SPACE */}
        <div className="flex-1 relative z-0 h-full w-full">
             <MapComponent 
                 currentLocation={currentLocation}
                 selectedUBS={ITAJAI_UBS_LIST.filter(u => selectedUBS.includes(u.id))}
                 optimizedRoute={optimizationResult?.route || null}
                 activeDrivers={isAdmin && viewState === 'admin-monitor' ? activeDrivers : undefined}
             />
        </div>

        {/* LOADING OVERLAY */}
        {loading && (
            <div className="fixed inset-0 z-[100] bg-[#002855]/90 backdrop-blur-sm flex flex-col items-center justify-center text-white">
                <Loader2 className="h-16 w-16 text-[#FBBF24] animate-spin mb-4" />
                <h3 className="text-xl font-bold">Calculando Rota...</h3>
                <p className="text-sm text-blue-200">Otimizando trajetos com IA</p>
            </div>
        )}

        {/* MODAL CONFIRMAÇÃO */}
        {confirmModal.isOpen && (
            <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white w-full max-w-sm rounded-xl overflow-hidden shadow-2xl animate-in zoom-in duration-200">
                    <div className="bg-[#002855] p-4 text-white font-bold flex justify-between items-center">
                        Confirmar Entrega
                        <button onClick={() => setConfirmModal({isOpen: false, stopId: null})}><X className="h-5 w-5"/></button>
                    </div>
                    <div className="p-4">
                         <p className="text-sm text-slate-600 mb-3">Observações (Opcional):</p>
                         <textarea 
                             className="w-full border border-slate-300 rounded p-2 text-sm h-24 focus:ring-2 focus:ring-[#002855] outline-none"
                             placeholder="Ex: Recebido por..."
                             value={noteText}
                             onChange={e => setNoteText(e.target.value)}
                         ></textarea>
                         <button onClick={handleConfirmDelivery} className="w-full bg-[#FBBF24] text-[#002855] font-bold py-3 rounded-lg mt-4 hover:brightness-105">
                             FINALIZAR ENTREGA
                         </button>
                    </div>
                </div>
            </div>
        )}

      </div>
    </div>
  );
}