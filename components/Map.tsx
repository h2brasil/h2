import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Coordinates, UBS, OptimizedStop, ActiveDriver } from '../types';

// Fix for default Leaflet marker icons in React without bundler image support
const iconUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png';
const iconShadowUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: iconUrl,
    shadowUrl: iconShadowUrl,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
});

L.Marker.prototype.options.icon = DefaultIcon;

// Custom icons
const createNumberIcon = (number: number) => {
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: #2563eb; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.3); font-size: 14px;">${number}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
};

const startIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: #16a34a; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 4px 8px rgba(0,0,0,0.4); animation: pulse 2s infinite;">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
           </div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
});

// Icone do Caminhão para o Admin
const truckIcon = L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="background-color: #FBBF24; color: #002855; width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.5); z-index: 1000;">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="13" x="4" y="5" rx="2" /><rect width="6" height="6" x="14" y="9" rx="2" /><path d="M4 15h13" /><path d="M18 19h2" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></svg>
         </div>`,
  iconSize: [48, 48],
  iconAnchor: [24, 24],
  popupAnchor: [0, -20]
});

interface MapProps {
  currentLocation: Coordinates | null;
  selectedUBS: UBS[];
  optimizedRoute: OptimizedStop[] | null;
  activeDrivers?: ActiveDriver[]; // List of multiple drivers for admin
}

// Helper to fit bounds
const RecenterMap = ({ coords }: { coords: Coordinates[] }) => {
  const map = useMap();
  useEffect(() => {
    if (coords.length > 0) {
      const bounds = L.latLngBounds(coords.map(c => [c.lat, c.lng]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }, [coords, map]);
  return null;
};

const MapComponent: React.FC<MapProps> = ({ currentLocation, selectedUBS, optimizedRoute, activeDrivers }) => {
  // Determine center priority: First driver -> Current Loc -> Default
  let center: [number, number] = [-26.9046, -48.6612];
  
  // Safe filtering of valid drivers to prevent crash
  const validDrivers = activeDrivers?.filter(d => 
    typeof d.lat === 'number' && !isNaN(d.lat) && 
    typeof d.lng === 'number' && !isNaN(d.lng)
  ) || [];

  if (validDrivers.length > 0) {
      center = [validDrivers[0].lat, validDrivers[0].lng];
  } else if (currentLocation) {
      center = [currentLocation.lat, currentLocation.lng];
  }

  const pointsToFit: Coordinates[] = [];
  if (currentLocation) pointsToFit.push(currentLocation);
  
  validDrivers.forEach(d => pointsToFit.push({ lat: d.lat, lng: d.lng }));
  
  if (optimizedRoute) {
    optimizedRoute.forEach(s => pointsToFit.push(s.coords));
  } else {
    selectedUBS.forEach(s => pointsToFit.push(s.coords));
  }

  return (
    <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      
      {/* Driver View Marker (Self) */}
      {!activeDrivers && currentLocation && (
        <Marker position={[currentLocation.lat, currentLocation.lng]} icon={startIcon}>
          <Popup><strong>Ponto de Partida</strong><br/>Sua localização atual</Popup>
        </Marker>
      )}

      {/* Admin View: Multiple Drivers */}
      {validDrivers.map((driver) => (
        <Marker 
            key={driver.id}
            position={[driver.lat, driver.lng]} 
            icon={truckIcon} 
            zIndexOffset={1000}
        >
          <Popup>
             <div className="text-center">
                <strong className="text-[#002855]">{driver.name}</strong><br/>
                <span className="text-xs text-green-600 font-bold">● Online</span><br/>
                <span className="text-[10px] text-slate-500">
                    {new Date(driver.updatedAt).toLocaleTimeString()}
                </span>
             </div>
          </Popup>
        </Marker>
      ))}

      {/* Render optimized route if available */}
      {optimizedRoute ? (
        optimizedRoute.map((stop) => (
          <Marker 
            key={stop.id} 
            position={[stop.coords.lat, stop.coords.lng]}
            icon={createNumberIcon(stop.sequence)}
          >
            <Popup>
              <strong>{stop.sequence}. {stop.name}</strong><br/>
              {stop.address}
            </Popup>
          </Marker>
        ))
      ) : (
        /* Render unordered selection */
        selectedUBS.map((stop) => (
          <Marker 
            key={stop.id} 
            position={[stop.coords.lat, stop.coords.lng]}
          >
             <Popup>
              <strong>{stop.name}</strong><br/>
              {stop.address}
            </Popup>
          </Marker>
        ))
      )}

      <RecenterMap coords={pointsToFit} />
    </MapContainer>
  );
};

export default MapComponent;