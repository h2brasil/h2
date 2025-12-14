import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Navigation, Loader2, RotateCcw, Crosshair, MapPin, Package, Calendar, Clock, History, CheckSquare, X, MessageSquare, Lock, User, LogOut, Truck, AlertTriangle, Wifi } from 'lucide-react';
import { ITAJAI_UBS_LIST } from './constants';
import { UBS, Coordinates, OptimizationResult, ViewState, DeliveryHistoryItem } from './types';
import MapComponent from './components/Map';
import { optimizeRoute } from './services/geminiService';

// Firebase Imports - Modular Syntax (Standard)
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, set, onValue, push } from "firebase/database";

// Configuração do Firebase fornecida pelo usuário
const firebaseConfig = {
  apiKey: "AIzaSyCuPiygb1O_hQaYT5LK7d6c0t_4_EyIz6s",
  authDomain: "h2brasil-20834.firebaseapp.com",
  databaseURL: "https://h2brasil-20834-default-rtdb.firebaseio.com",
  projectId: "h2brasil-20834",
  storageBucket: "h2brasil-20834.firebasestorage.app",
  messagingSenderId: "344038367500",
  appId: "1:344038367500:web:77a23899f7644bf671e929"
};

// Inicializa o Firebase com tratamento de erro robusto
let app;
let db: any = null;
let firebaseErrorMsg = "";

try {
  // Check if any app is already initialized to prevent hot-reload errors
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApp();
  }
  db = getDatabase(app);
} catch (error: any) {
  console.error("Erro crítico ao inicializar Firebase:", error);
  // O erro "Service database is not available" ocorre quando há conflito de versões
  if (error.message && error.message.includes("Service database is not available")) {
      firebaseErrorMsg = "Conflito de Versão do Firebase: O banco de dados não pôde ser carregado. Tente recarregar a página.";
  } else if (error.code === 'app/no-app') {
      firebaseErrorMsg = "Erro de Inicialização do App.";
  } else {
      firebaseErrorMsg = "Conexão com Banco de Dados falhou: " + (error.message || "Erro desconhecido");
  }
}

// Logo Component replicating H2 Brasil Brand
const H2Logo = () => (
  <svg viewBox="0 0 100 100" className="h-12 w-12 mr-3 drop-shadow-sm" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Drop Shape Background */}
    <path d="M50 5 C50 5 10 45 10 65 C10 87 28 100 50 100 C72 100 90 87 90 65 C90 45 50 5 50 5Z" fill="white"/>
    {/* Green part */}
    <path d="M50 5 C50 5 15 42 12 60 C12 60 20 80 50 80 C40 60 50 5 50 5Z" fill="#166534" /> 
    {/* Yellow part */}
    <path d="M50 100 C72 100 90 87 90 65 C90 50 70 25 50 5 C55 30 60 60 30 85 C35 95 42 100 50 100Z" fill="#EAB308" />
    {/* Blue Circle/Drop inside */}
    <circle cx="50" cy="65" r="18" fill="#003366" />
    {/* Water drops inside blue */}
    <path d="M50 55 L53 60 H47 Z" fill="white" />
    <path d="M45 65 L48 70 H42 Z" fill="white" />
    <path d="M55 65 L58 70 H52 Z" fill="white" />
  </svg>
);

export default function App() {
  const [selectedUBS, setSelectedUBS] = useState<string[]>([]);
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<'locating' | 'found' | 'error'>('locating');
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [viewState, setViewState] = useState<ViewState>('selection');
  const [loading, setLoading] = useState(false);
  // Se houver erro de inicialização do firebase, mostramos isso, senão erro normal
  const [error, setError] = useState<string | null>(firebaseErrorMsg || null);
  
  // Admin State
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [adminTrackingLocation, setAdminTrackingLocation] = useState<Coordinates | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  // History State
  const [history, setHistory] = useState<DeliveryHistoryItem[]>([]);
  const [historyDateFilter, setHistoryDateFilter] = useState<string>(new Date().toISOString().split('T')[0]);

  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; stopId: string | null }>({ isOpen: false, stopId: null });
  const [noteText, setNoteText] = useState('');

  // --- LÓGICA DE HISTÓRICO NO BANCO DE DADOS ---
  useEffect(() => {
    if (!db) return;

    // Escuta mudanças na pasta 'history' do banco de dados
    const historyRef = ref(db, 'history');
    
    // onValue é a forma modular de ler dados
    const unsubscribe = onValue(historyRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // O Firebase retorna um Objeto { id1: dados, id2: dados }, transformamos em Array
        const historyArray = Object.values(data) as DeliveryHistoryItem[];
        // Ordena do mais recente para o mais antigo
        const sortedHistory = historyArray.sort((a, b) => {
           return (b.date + b.completedAt).localeCompare(a.date + a.completedAt);
        });
        setHistory(sortedHistory);
      } else {
        setHistory([]);
      }
    }, (error) => {
      console.error("Erro ao ler histórico:", error);
      // Não sobrescreve erro principal se for apenas permissão
      if (!firebaseErrorMsg) {
         setError("Erro ao ler banco de dados. Verifique sua conexão ou permissões.");
      }
    });

    return () => unsubscribe();
  }, []);

  // Inicializa GPS
  useEffect(() => {
      getLocation();
  }, []);

  // --- LOGICA DE RASTREAMENTO (LADO DO ENTREGADOR) ---
  useEffect(() => {
      let watchId: number;

      // Se NÃO for admin, é o entregador. Vamos monitorar a posição dele.
      // Importante: verificar se db existe antes de tentar escrever
      if (!isAdmin && navigator.geolocation) {
          watchId = navigator.geolocation.watchPosition(
              (position) => {
                  const { latitude, longitude } = position.coords;
                  const newLocation = { lat: latitude, lng: longitude };
                  
                  // Atualiza local no app do entregador
                  setCurrentLocation(newLocation);
                  setLocationStatus('found');

                  // *** ENVIA PARA FIREBASE ***
                  if (db) {
                    set(ref(db, 'drivers/current'), { 
                      lat: latitude, 
                      lng: longitude,
                      updatedAt: Date.now()
                    }).catch((err: any) => {
                        console.error("Erro ao enviar localização:", err);
                    });
                  }
              },
              (err) => {
                  console.error("Erro no rastreamento:", err);
                  setLocationStatus('error');
              },
              { enableHighAccuracy: true }
          );
      } 

      return () => {
          if (watchId) navigator.geolocation.clearWatch(watchId);
      };
  }, [isAdmin]);

  // --- LOGICA DE MONITORAMENTO (LADO DO ADMIN) ---
  useEffect(() => {
      // Se for admin e estiver na tela de monitoramento, escuta o Firebase
      if (isAdmin && viewState === 'admin-monitor' && db) {
          const driverRef = ref(db, 'drivers/current');
          
          const unsubscribe = onValue(driverRef, (snapshot) => {
              const data = snapshot.val();
              if (data && data.lat && data.lng) {
                  setAdminTrackingLocation({ lat: data.lat, lng: data.lng });
                  setLastUpdate(data.updatedAt);
              }
          });

          return () => unsubscribe();
      }
  }, [isAdmin, viewState]);

  const getLocation = () => {
    setLocationStatus('locating');
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setLocationStatus('found');
        },
        (err) => {
          console.error(err);
          // Fallback para centro de Itajaí se GPS falhar
          setCurrentLocation({ lat: -26.9046, lng: -48.6612 });
          setLocationStatus('error');
        },
        { enableHighAccuracy: true }
      );
    } else {
      setLocationStatus('error');
      setCurrentLocation({ lat: -26.9046, lng: -48.6612 });
    }
  };

  const handleLogin = () => {
      if (username === 'admin' && password === 'lulaladrao') {
          setIsAdmin(true);
          setShowLoginModal(false);
          setViewState('admin-monitor');
          setLoginError('');
      } else {
          setLoginError('Credenciais inválidas.');
      }
  };

  const logout = () => {
      setIsAdmin(false);
      setUsername('');
      setPassword('');
      setViewState('selection');
      setAdminTrackingLocation(null);
  };

  const toggleUBS = (id: string) => {
    setSelectedUBS((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
      if (selectedUBS.length === ITAJAI_UBS_LIST.length) {
          setSelectedUBS([]);
      } else {
          setSelectedUBS(ITAJAI_UBS_LIST.map(u => u.id));
      }
  };

  const handleOptimization = async () => {
    if (selectedUBS.length === 0) {
      setError("Selecione pelo menos um ponto de entrega.");
      return;
    }
    if (!currentLocation) {
        setError("Aguardando sinal de GPS...");
        getLocation();
        return;
    }

    setLoading(true);
    setViewState('optimizing');
    setError(null);

    try {
      const selectedData = ITAJAI_UBS_LIST.filter(u => selectedUBS.includes(u.id));
      const result = await optimizeRoute(currentLocation, selectedData);
      setOptimizationResult(result);
      setViewState('result');
    } catch (e: any) {
      console.error("Erro na Otimização:", e);
      let msg = e.message || "Falha ao calcular logística.";
      
      // Detecção específica do erro de API Key da IA
      if (JSON.stringify(e).includes("API key not valid") || msg.includes("API key not valid")) {
          msg = "ERRO NA IA: A chave de API do Gemini (IA) é inválida. Verifique o arquivo .env ou a configuração.";
      }
      
      setError(msg);
      setViewState('selection');
    } finally {
      setLoading(false);
    }
  };

  const openConfirmModal = (stopId: string) => {
    setNoteText('');
    setConfirmModal({ isOpen: true, stopId });
  }

  const handleConfirmDelivery = () => {
    if (!optimizationResult || !confirmModal.stopId) return;

    const stopId = confirmModal.stopId;
    const now = new Date();
    const timestamp = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dateKey = now.toISOString().split('T')[0];

    // 1. Atualiza a rota atual visualmente (memória local apenas para UI da rota)
    const updatedRoute = optimizationResult.route.map(stop => {
        if (stop.id === stopId) {
            return { 
                ...stop, 
                status: 'completed' as const, 
                completedAt: timestamp,
                notes: noteText
            };
        }
        return stop;
    });

    setOptimizationResult({ ...optimizationResult, route: updatedRoute });

    // 2. Salva no Banco de Dados (Firebase)
    const stopDetails = optimizationResult.route.find(s => s.id === stopId);
    if (stopDetails && db) {
        const newHistoryItem: DeliveryHistoryItem = {
            id: stopId + '-' + now.getTime(), // unique id
            stopName: stopDetails.name,
            address: stopDetails.address,
            completedAt: timestamp,
            date: dateKey,
            notes: noteText
        };

        // Cria uma nova entrada na lista 'history'
        // push() gera uma chave única
        const newListRef = push(ref(db, 'history'));
        set(newListRef, newHistoryItem)
          .catch((err) => {
            console.error("Erro ao salvar histórico:", err);
            setError("Erro ao salvar no banco de dados. Verifique a internet.");
          });
    } else if (!db) {
        setError("Banco de dados desconectado. Histórico salvo apenas localmente (será perdido ao recarregar).");
    }
    
    // Close Modal
    setConfirmModal({ isOpen: false, stopId: null });
  };

  const reset = () => {
    setViewState('selection');
    setSelectedUBS([]);
  };

  const toggleHistory = () => {
    if (isAdmin) {
        return; 
    }
    if (viewState === 'history') {
        setViewState(optimizationResult ? 'result' : 'selection');
    } else {
        setViewState('history');
    }
  };

  const selectedUBSObjects = ITAJAI_UBS_LIST.filter(u => selectedUBS.includes(u.id));
  const filteredHistory = history.filter(item => item.date === historyDateFilter);

  // Formata o tempo desde a última atualização
  const getLastUpdateText = () => {
      if (!lastUpdate) return 'Aguardando dados...';
      const seconds = Math.floor((Date.now() - lastUpdate) / 1000);
      if (seconds < 60) return 'Atualizado agora mesmo';
      return `Atualizado há ${Math.floor(seconds/60)} min`;
  };

  // Safe render fallback for critical errors
  if (error && error.includes("Conflito de Versão")) {
      return (
          <div className="h-screen w-screen flex flex-col items-center justify-center bg-red-50 p-6 text-center">
              <AlertTriangle className="h-12 w-12 text-red-600 mb-4" />
              <h1 className="text-xl font-bold text-red-800">Erro de Inicialização</h1>
              <p className="text-red-600 mt-2">{error}</p>
              <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-red-600 text-white rounded shadow">
                  Recarregar Aplicação
              </button>
          </div>
      )
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden font-sans">
      {/* Professional Header - Navy Blue */}
      <header className="bg-[#002855] text-white p-3 shadow-lg flex items-center justify-between z-20 border-b border-[#001f40]">
        <div className="flex items-center">
          <H2Logo />
          <div>
            <h1 className="text-xl md:text-2xl font-extrabold tracking-tight text-white leading-tight">
              H2 BRASIL <span className="text-[#FBBF24] font-light">DISTRIBUIDORA</span>
            </h1>
            <p className="text-[10px] md:text-xs text-blue-200 uppercase tracking-widest font-semibold mt-0.5">
              {isAdmin ? 'MÓDULO ADMINISTRATIVO' : 'Sistema de Logística Inteligente'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 md:gap-3">
            {/* Admin Controls */}
            {isAdmin ? (
                <div className="flex items-center gap-2">
                    <span className="text-xs bg-yellow-500 text-[#002855] font-bold px-2 py-1 rounded hidden md:inline">
                        Admin Logado
                    </span>
                    <button 
                        onClick={logout}
                        className="bg-red-600 hover:bg-red-700 p-2 rounded-lg text-white transition shadow-sm"
                        title="Sair do Admin"
                    >
                        <LogOut className="h-5 w-5" />
                    </button>
                </div>
            ) : (
                <>
                    <div className={`hidden md:flex px-3 py-1 rounded-full text-xs font-medium border items-center gap-2 ${locationStatus === 'found' ? 'bg-green-900/30 border-green-500 text-green-400' : 'bg-red-900/30 border-red-500 text-red-400'}`}>
                        <div className={`w-2 h-2 rounded-full ${locationStatus === 'found' ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`}></div>
                        {locationStatus === 'found' ? 'GPS ON' : 'GPS OFF'}
                    </div>

                    <button 
                        onClick={toggleHistory}
                        className={`p-2 rounded-lg text-white transition border border-[#004080] shadow-sm flex items-center gap-2 ${viewState === 'history' ? 'bg-[#FBBF24] text-[#002855] font-bold' : 'bg-[#003366] hover:bg-[#004080]'}`}
                        title="Histórico de Entregas"
                    >
                        <History className="h-5 w-5" />
                        <span className="hidden md:inline text-sm">Histórico</span>
                    </button>

                    <button 
                        onClick={getLocation}
                        className="bg-[#003366] hover:bg-[#004080] p-2 rounded-lg text-white transition border border-[#004080] shadow-sm"
                        title="Recalibrar GPS"
                    >
                        <Crosshair className={`h-5 w-5 ${locationStatus === 'locating' ? 'animate-spin' : ''}`} />
                    </button>
                    
                    <button 
                        onClick={() => setShowLoginModal(true)}
                        className="bg-[#001f33] hover:bg-[#001522] p-2 rounded-lg text-slate-400 hover:text-white transition border border-[#004080] shadow-sm"
                        title="Acesso Administrativo"
                    >
                        <Lock className="h-5 w-5" />
                    </button>

                    <button 
                        onClick={reset}
                        className={`text-sm bg-[#FBBF24] hover:bg-[#f59e0b] text-[#002855] font-bold px-4 py-2 rounded-lg flex items-center gap-1 transition-all duration-300 shadow-md ${viewState === 'result' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10 pointer-events-none hidden'}`}
                    >
                        <RotateCcw className="h-4 w-4" /> <span className="hidden md:inline">Nova Rota</span>
                    </button>
                </>
            )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        
        {/* Sidebar */}
        <div className={`
          absolute md:relative z-[500] md:z-auto
          w-full md:w-[400px] 
          h-[65vh] md:h-full 
          bottom-0 md:bottom-auto
          bg-white shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.2)] md:shadow-xl border-r border-slate-200
          flex flex-col
          transition-transform duration-300
          ${viewState === 'optimizing' ? 'translate-y-full md:translate-x-full md:hidden' : 'translate-y-0'}
        `}>
          
          <div className="relative w-full h-full overflow-hidden bg-slate-50">
            
            {/* Selection Panel (Driver) */}
            <div className={`
                absolute inset-0 w-full h-full flex flex-col 
                transition-all duration-500 ease-in-out transform
                ${viewState === 'selection' ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-10 pointer-events-none'}
            `}>
                <div className="p-5 bg-white border-b border-slate-200 shadow-sm z-10">
                    <div className="flex justify-between items-center mb-1">
                        <h2 className="text-lg font-bold text-[#002855] flex items-center gap-2">
                            <Package className="h-5 w-5 text-[#FBBF24]" />
                            Pontos de Entrega
                        </h2>
                        <span className="bg-slate-100 text-slate-600 text-xs font-bold px-2 py-1 rounded-full border border-slate-200">
                            {selectedUBS.length} Selecionados
                        </span>
                    </div>
                    <div className="flex justify-between items-center mt-2">
                        <p className="text-xs text-slate-500">Selecione os clientes para a rota de hoje.</p>
                        <button onClick={selectAll} className="text-xs text-[#002855] font-semibold hover:text-[#FBBF24] transition-colors">
                            {selectedUBS.length === ITAJAI_UBS_LIST.length ? 'Limpar Seleção' : 'Selecionar Todos'}
                        </button>
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {ITAJAI_UBS_LIST.map((ubs) => (
                    <div 
                        key={ubs.id}
                        onClick={() => toggleUBS(ubs.id)}
                        className={`
                        group p-3 rounded-lg cursor-pointer border-l-4 transition-all duration-200
                        flex items-start gap-3 relative overflow-hidden
                        ${selectedUBS.includes(ubs.id) 
                            ? 'bg-white border-l-[#002855] border-t border-r border-b border-slate-200 shadow-md' 
                            : 'bg-white border-l-transparent border border-slate-100 hover:border-slate-300'
                        }
                        `}
                    >
                        <div className={`
                        w-6 h-6 rounded-full border-2 flex items-center justify-center mt-0.5 flex-shrink-0 transition-colors
                        ${selectedUBS.includes(ubs.id) ? 'bg-[#002855] border-[#002855]' : 'border-slate-300 group-hover:border-[#FBBF24]'}
                        `}>
                        {selectedUBS.includes(ubs.id) && <CheckCircle2 className="h-4 w-4 text-white" />}
                        </div>
                        <div className="flex-1">
                          <h3 className={`font-bold text-sm ${selectedUBS.includes(ubs.id) ? 'text-[#002855]' : 'text-slate-700'}`}>
                              {ubs.name}
                          </h3>
                          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {ubs.address}
                          </p>
                        </div>
                    </div>
                    ))}
                </div>

                <div className="p-4 bg-white border-t border-slate-200 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] z-10">
                    {error && <div className="bg-red-50 text-red-600 text-xs p-2 rounded mb-3 text-center border border-red-100">{error}</div>}
                    <button
                    onClick={handleOptimization}
                    disabled={selectedUBS.length === 0}
                    className={`
                        w-full py-3.5 rounded-lg font-bold text-sm tracking-wide flex items-center justify-center gap-2
                        transition-all shadow-lg active:scale-[0.98]
                        ${selectedUBS.length > 0 
                        ? 'bg-gradient-to-r from-[#FBBF24] to-[#F59E0B] text-[#002855] hover:brightness-110' 
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'}
                    `}
                    >
                    <Navigation className="h-5 w-5" />
                    OTIMIZAR ROTA DE ENTREGA
                    </button>
                </div>
            </div>

            {/* Admin Monitor Panel */}
             <div className={`
                absolute inset-0 w-full h-full flex flex-col bg-slate-50
                transition-all duration-500 ease-in-out transform
                ${viewState === 'admin-monitor' ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-10 pointer-events-none'}
            `}>
                <div className="p-5 bg-gradient-to-r from-[#002855] to-[#001f40] text-white shadow-md">
                    <h2 className="text-lg font-bold flex items-center gap-2 mb-1">
                        <Truck className="h-5 w-5 text-[#FBBF24]" />
                        Monitoramento em Tempo Real
                    </h2>
                    <p className="text-xs text-blue-200">
                        Acompanhe a localização da frota.
                    </p>
                    <div className="mt-4 bg-white/10 p-3 rounded border border-white/20">
                         <div className="flex items-center gap-2 mb-2">
                             <div className={`w-2 h-2 rounded-full ${adminTrackingLocation ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`}></div>
                             <span className="text-xs font-bold text-white">
                                 {adminTrackingLocation ? 'Veículo Conectado' : 'Aguardando Sinal...'}
                             </span>
                         </div>
                         <p className="text-[10px] text-blue-200 flex gap-2 items-start">
                             <Wifi className="h-4 w-4 text-green-400 flex-shrink-0" />
                             <span>
                                O sistema está recebendo dados de localização ao vivo do dispositivo móvel do entregador via satélite/internet.
                             </span>
                         </p>
                    </div>
                </div>
                
                <div className="p-4">
                     <h3 className="text-sm font-bold text-[#002855] mb-2">Status da Frota</h3>
                     <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                         <div className="flex justify-between items-center border-b border-slate-100 pb-2 mb-2">
                             <span className="text-xs text-slate-500">Motorista Ativo</span>
                             <span className="text-xs font-bold text-slate-800">Entregador H2</span>
                         </div>
                         <div className="flex justify-between items-center border-b border-slate-100 pb-2 mb-2">
                             <span className="text-xs text-slate-500">Última Atualização</span>
                             <span className="text-xs font-bold text-slate-800">{getLastUpdateText()}</span>
                         </div>
                         <div className="flex justify-between items-center">
                             <span className="text-xs text-slate-500">Status GPS</span>
                             <span className={`text-xs font-bold ${adminTrackingLocation ? 'text-green-600' : 'text-red-500'}`}>
                                 {adminTrackingLocation ? 'Online' : 'Offline'}
                             </span>
                         </div>
                     </div>
                </div>
            </div>


            {/* History Panel */}
            <div className={`
                absolute inset-0 w-full h-full flex flex-col bg-white
                transition-all duration-500 ease-in-out transform
                ${viewState === 'history' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10 pointer-events-none'}
            `}>
                <div className="p-5 bg-[#002855] text-white shadow-md">
                    <h2 className="text-lg font-bold flex items-center gap-2 mb-3">
                        <History className="h-5 w-5 text-[#FBBF24]" />
                        Histórico de Entregas
                    </h2>
                    
                    {/* Fixed Calendar Input - 100% Clickable Area */}
                    <div className="relative group cursor-pointer">
                        <div className="flex items-center justify-between bg-[#003366] group-hover:bg-[#004080] p-3 rounded-lg border border-[#004080] transition-colors">
                            <div className="flex items-center gap-2">
                                <Calendar className="h-5 w-5 text-[#FBBF24]" />
                                <span className="text-sm text-blue-100">Filtrar por data:</span>
                            </div>
                            <span className="text-base font-bold text-white tracking-wide">
                                {new Date(historyDateFilter).toLocaleDateString('pt-BR')}
                            </span>
                        </div>
                        
                        {/* 
                           Este input cobre todo o botão pai. 
                           Ele é invisível (opacity-0), mas recebe o clique.
                           Ao clicar, o navegador abre o calendário nativo.
                        */}
                        <input 
                            type="date" 
                            value={historyDateFilter}
                            onChange={(e) => setHistoryDateFilter(e.target.value)}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                            style={{ display: 'block' }} 
                        />
                    </div>
                    <p className="text-[10px] text-blue-300 mt-1 text-center">Toque na data acima para abrir o calendário</p>
                </div>

                <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
                    {filteredHistory.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <CheckSquare className="h-12 w-12 mb-2 opacity-20" />
                            <p className="text-sm">Nenhuma entrega registrada nesta data.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                             {filteredHistory.map((item) => (
                                <div key={item.id} className="bg-white p-3 rounded-lg border-l-4 border-l-green-500 shadow-sm flex flex-col gap-1">
                                    <div className="flex justify-between items-start">
                                        <h3 className="font-bold text-slate-800 text-sm">{item.stopName}</h3>
                                        <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                            <Clock className="h-3 w-3" /> {item.completedAt}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500">{item.address}</p>
                                    {item.notes && (
                                        <div className="mt-2 bg-yellow-50 p-2 rounded border border-yellow-100">
                                            <p className="text-[11px] text-yellow-800 italic flex items-start gap-1">
                                                <MessageSquare className="h-3 w-3 mt-0.5 flex-shrink-0" /> 
                                                "{item.notes}"
                                            </p>
                                        </div>
                                    )}
                                </div>
                             ))}
                        </div>
                    )}
                </div>
                <div className="p-4 border-t bg-white">
                     <div className="flex justify-between text-xs text-slate-500 font-medium">
                         <span>Total no dia:</span>
                         <span className="text-[#002855] font-bold">{filteredHistory.length} entregas</span>
                     </div>
                </div>
            </div>

            {/* Result Panel */}
            <div className={`
                absolute inset-0 w-full h-full flex flex-col bg-white
                transition-all duration-500 ease-in-out transform
                ${viewState === 'result' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10 pointer-events-none'}
            `}>
                {optimizationResult && (
                    <>
                    <div className="p-5 bg-[#F0FDF4] border-b border-green-100">
                        <div className="flex items-center gap-3">
                            <div className="bg-green-100 p-2 rounded-full">
                                <CheckCircle2 className="h-6 w-6 text-green-600" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-green-800">Rota Otimizada</h2>
                                <p className="text-xs text-green-700 font-medium">
                                    Distância Estimada: <span className="bg-green-200 px-1.5 py-0.5 rounded text-green-900">{optimizationResult.totalDistanceEst}</span>
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 bg-blue-50/50 border-b border-blue-100">
                        <p className="text-sm text-blue-900 italic leading-relaxed">
                            <span className="font-bold not-italic mr-1">Resumo IA:</span> 
                            {optimizationResult.summary}
                        </p>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
                        <div className="relative border-l-2 border-slate-300 ml-3 space-y-6 pb-6">
                            {/* Start Point */}
                            <div className="relative pl-8">
                                <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-green-500 border-2 border-white shadow ring-4 ring-green-50"></div>
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-extrabold text-green-600 uppercase tracking-widest mb-1">Início da Jornada</span>
                                    <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                                        <p className="text-sm font-bold text-slate-800">H2 Distribuidora (Móvel)</p>
                                        <p className="text-xs text-slate-500">Localização atual do veículo</p>
                                    </div>
                                </div>
                            </div>

                            {/* Stops */}
                            {optimizationResult.route.map((stop, idx) => {
                                const isCompleted = stop.status === 'completed';
                                return (
                                <div key={stop.id} className={`relative pl-8 transition-all duration-500 ${isCompleted ? 'opacity-60 grayscale-[0.8]' : 'opacity-100'}`}>
                                    <div className={`
                                        absolute -left-[12px] top-0 w-6 h-6 rounded-full border-2 border-white shadow-md flex items-center justify-center text-[11px] font-bold z-10 transition-colors
                                        ${isCompleted ? 'bg-green-600 text-white' : 'bg-[#002855] text-[#FBBF24]'}
                                    `}>
                                    {isCompleted ? <CheckCircle2 className="h-3 w-3" /> : stop.sequence}
                                    </div>
                                    
                                    <div className={`
                                        bg-white p-3 rounded-lg border shadow-sm transition-all group
                                        ${isCompleted ? 'border-green-200 bg-green-50' : 'border-slate-200 hover:shadow-md'}
                                    `}>
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className={`text-sm font-bold ${isCompleted ? 'text-green-800 line-through' : 'text-[#002855]'}`}>{stop.name}</h3>
                                                <p className="text-xs text-slate-500 mt-1">{stop.address}</p>
                                            </div>
                                            {isCompleted && (
                                                <span className="text-[10px] bg-green-200 text-green-800 px-1.5 py-0.5 rounded font-bold">
                                                    Entregue: {stop.completedAt}
                                                </span>
                                            )}
                                        </div>
                                        
                                        {!isCompleted && (
                                            <div className="flex gap-2 mt-3">
                                                <a 
                                                    href={`https://www.google.com/maps/dir/?api=1&destination=${stop.coords.lat},${stop.coords.lng}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-slate-50 hover:bg-blue-50 text-[#002855] text-xs font-bold rounded border border-slate-200 hover:border-blue-200 transition-colors"
                                                >
                                                    <Navigation className="h-3.5 w-3.5" /> NAVEGAR
                                                </a>
                                                <button
                                                    onClick={() => openConfirmModal(stop.id)}
                                                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-[#FBBF24] hover:bg-[#F59E0B] text-[#002855] text-xs font-bold rounded shadow-sm transition-colors"
                                                >
                                                    <CheckSquare className="h-3.5 w-3.5" /> CONFIRMAR
                                                </button>
                                            </div>
                                        )}
                                        {isCompleted && stop.notes && (
                                            <div className="mt-2 text-xs text-slate-600 italic border-t pt-2 flex items-start gap-1">
                                                <MessageSquare className="h-3 w-3 flex-shrink-0 mt-0.5 text-slate-400" /> "{stop.notes}"
                                            </div>
                                        )}
                                    </div>
                                    {idx !== optimizationResult.route.length - 1 && (
                                        <div className="absolute left-[-1px] top-6 bottom-[-24px] w-0.5 border-l-2 border-dashed border-slate-300"></div>
                                    )}
                                </div>
                            )})}
                        </div>
                    </div>
                    </>
                )}
            </div>
            
          </div>
        </div>

        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 z-[1000] bg-[#002855]/90 backdrop-blur-sm flex flex-col items-center justify-center text-white">
            <Loader2 className="h-16 w-16 text-[#FBBF24] animate-spin mb-6" />
            <h2 className="text-2xl font-bold tracking-tight">Otimizando Logística...</h2>
            <p className="text-blue-200 text-sm mt-3 text-center max-w-sm px-4">
              Nossa IA está calculando a rota mais eficiente considerando o trânsito e a geografia de Itajaí.
            </p>
          </div>
        )}

        {/* Login Modal */}
        {showLoginModal && (
            <div className="absolute inset-0 z-[2000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-xs rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                    <div className="bg-[#002855] p-6 text-center">
                        <div className="mx-auto w-12 h-12 bg-[#FBBF24] rounded-full flex items-center justify-center mb-3 text-[#002855]">
                             <Lock className="h-6 w-6" />
                        </div>
                        <h3 className="text-white font-bold text-lg">Acesso Restrito</h3>
                        <p className="text-blue-200 text-xs">Apenas para gestores</p>
                    </div>
                    <div className="p-6">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Usuário</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                    <input 
                                        type="text" 
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002855]"
                                        placeholder="admin"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Senha</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                    <input 
                                        type="password" 
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002855]"
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>
                            
                            {loginError && (
                                <p className="text-red-500 text-xs font-bold text-center">{loginError}</p>
                            )}

                            <button 
                                onClick={handleLogin}
                                className="w-full py-2.5 text-[#002855] font-bold text-sm bg-[#FBBF24] hover:bg-[#F59E0B] rounded-lg shadow-md transition-colors"
                            >
                                ACESSAR PAINEL
                            </button>
                            <button 
                                onClick={() => {
                                    setShowLoginModal(false);
                                    setLoginError('');
                                    setUsername('');
                                    setPassword('');
                                }}
                                className="w-full py-2 text-slate-500 font-bold text-xs hover:text-slate-700"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* Confirmation Modal */}
        {confirmModal.isOpen && (
            <div className="absolute inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-sm rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                    <div className="bg-[#002855] p-4 flex justify-between items-center">
                        <h3 className="text-white font-bold flex items-center gap-2">
                            <CheckSquare className="h-5 w-5 text-[#FBBF24]" />
                            Confirmar Entrega
                        </h3>
                        <button onClick={() => setConfirmModal({isOpen: false, stopId: null})} className="text-white/70 hover:text-white">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                    <div className="p-5">
                        <p className="text-sm text-slate-600 mb-4">
                            Deseja confirmar a entrega para: <br/>
                            <span className="font-bold text-[#002855] text-base">
                                {optimizationResult?.route.find(s => s.id === confirmModal.stopId)?.name}
                            </span>
                        </p>
                        
                        <label className="block text-xs font-bold text-slate-500 mb-2">Observações (Opcional)</label>
                        <textarea
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                            placeholder="Ex: Recebido pelo porteiro, portão estava fechado..."
                            className="w-full p-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002855] min-h-[80px]"
                        ></textarea>

                        <div className="flex gap-3 mt-5">
                            <button 
                                onClick={() => setConfirmModal({isOpen: false, stopId: null})}
                                className="flex-1 py-3 text-slate-600 font-bold text-sm bg-slate-100 hover:bg-slate-200 rounded-lg"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={handleConfirmDelivery}
                                className="flex-1 py-3 text-[#002855] font-bold text-sm bg-[#FBBF24] hover:bg-[#F59E0B] rounded-lg shadow-md"
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* Map Area */}
        <div className="flex-1 h-[40vh] md:h-full relative z-0">
          <MapComponent 
            currentLocation={currentLocation}
            selectedUBS={selectedUBSObjects}
            optimizedRoute={optimizationResult?.route || null}
            adminTrackingLocation={isAdmin && viewState === 'admin-monitor' ? adminTrackingLocation : null}
          />
        </div>

      </div>
    </div>
  );
}