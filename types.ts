export interface Coordinates {
  lat: number;
  lng: number;
}

export interface UBS {
  id: string;
  name: string;
  address: string;
  coords: Coordinates;
}

export interface OptimizedStop extends UBS {
  sequence: number;
  distanceFromPrev?: string; // Estimated
  status: 'pending' | 'completed';
  completedAt?: string; // ISO String timestamp
  notes?: string; // Observações da entrega
}

export interface OptimizationResult {
  route: OptimizedStop[];
  summary: string;
  totalDistanceEst: string;
}

export interface DeliveryHistoryItem {
  id: string;
  stopName: string;
  address: string;
  completedAt: string;
  date: string; // YYYY-MM-DD for grouping
  notes?: string;
}

export interface ActiveDriver {
  id: string;
  name: string;
  lat: number;
  lng: number;
  updatedAt: number;
  status: 'online' | 'offline' | 'busy';
  currentDestination?: string;
}

export type ViewState = 'login' | 'selection' | 'optimizing' | 'result' | 'history' | 'admin-monitor';