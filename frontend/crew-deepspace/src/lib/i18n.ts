/**
 * All wording the crew sees, English and Spanish side by side.
 * To change a sentence, edit it here; to add a language, add a third column.
 * Use {name} for a value that is filled in (for example "{n} min").
 * Spanish uses "usted" (formal), the usual register for safety wording on a job site.
 * SAFETY WORDING (marked "safety") should be read by a native Spanish speaker before real use.
 *
 * Text that comes from the server (the briefing, score explanations, hazard summaries, AI suggestions,
 * and anything a crew member types) is shown as the server sent it.
 */
import { useMemo } from 'react'
import { useLanguage, type Lang } from './language'

const STR = {
  // ---- shell
  'nav.site': { en: 'Site', es: 'Sitio' },
  'nav.briefing': { en: 'Briefing', es: 'Informe' },
  'nav.map': { en: 'Map', es: 'Mapa' },
  'nav.report': { en: 'Report', es: 'Reportar' },
  'nav.team': { en: 'Team', es: 'Equipo' },
  'nav.label': { en: 'Crew app', es: 'Aplicación de la cuadrilla' },
  'brand.crew': { en: 'Crew', es: 'Cuadrilla' },
  'sun.label': { en: 'Sunlight mode', es: 'Modo luz solar' },
  'sun.title': { en: 'Sunlight mode: high contrast for bright light', es: 'Modo luz solar: alto contraste para luz brillante' },
  'sun.on': { en: 'Sunlight on', es: 'Luz solar activa' },
  'sun.off': { en: 'Sunlight', es: 'Luz solar' },
  'lang.short.toEs': { en: 'ES', es: 'EN' },
  'lang.name.toEs': { en: 'Español', es: 'English' },
  'lang.label': { en: 'Cambiar a español (Switch to Spanish)', es: 'Switch to English (Cambiar a inglés)' },
  'auth.signIn': { en: 'Sign in', es: 'Iniciar sesión' },
  'auth.signOut': { en: 'Sign out', es: 'Cerrar sesión' },
  'auth.signOutAs': { en: 'Sign out ({who})', es: 'Cerrar sesión ({who})' },
  'banner.demo': { en: 'Demo data, not real conditions. Your site is a sample.', es: 'Datos de demostración, no son condiciones reales. Su sitio es un ejemplo.' },
  'banner.unverified': { en: 'Sign-in not re-checked yet. It checks again when signal returns.', es: 'Aún no se ha vuelto a verificar su inicio de sesión. Se verifica de nuevo cuando vuelva la señal.' },
  'net.onlineReady': { en: 'Online. Saved for offline use', es: 'En línea. Guardado para usar sin señal' },
  'net.onlineSaving': { en: 'Online. Saving for offline use...', es: 'En línea. Guardando para usar sin señal...' },
  'net.offline': { en: 'No signal: showing saved data', es: 'Sin señal: mostrando datos guardados' },
  'fresh.updated': { en: 'Last updated {age}', es: 'Última actualización: {age}' },
  'fresh.old': { en: ' (old data)', es: ' (datos viejos)' },
  'fresh.never': { en: 'Not updated yet', es: 'Aún sin actualizar' },
  'queue.waiting': { en: ' waiting to upload', es: ' esperando para subir' },
  'loading': { en: 'Loading...', es: 'Cargando...' },

  // ---- display panel
  'disp.label': { en: 'Display settings: font, text size, spacing', es: 'Pantalla: tipo de letra, tamaño y espacio' },
  'disp.button': { en: 'Display', es: 'Pantalla' },
  'disp.dialog': { en: 'Display settings', es: 'Ajustes de pantalla' },
  'disp.font': { en: 'Font', es: 'Tipo de letra' },
  'disp.sample1': { en: 'Sample text: Your site, 12 miles, 3:45 PM', es: 'Texto de muestra: Su sitio, 12 millas, 3:45 PM' },
  'disp.sample2': { en: 'Letters that look alike: Il1 O0 rn m b d p q', es: 'Letras parecidas: Il1 O0 rn m b d p q' },
  'disp.size': { en: 'Text size', es: 'Tamaño del texto' },
  'disp.md': { en: 'Normal', es: 'Normal' },
  'disp.lg': { en: 'Large', es: 'Grande' },
  'disp.xl': { en: 'Larger', es: 'Más grande' },
  'disp.spacing': { en: 'Easier spacing', es: 'Espacio más cómodo' },
  'disp.spacingHint': { en: 'More room between lines, letters and words. No all-capital labels.', es: 'Más espacio entre líneas, letras y palabras. Sin etiquetas en mayúsculas.' },
  'disp.reset': { en: 'Reset', es: 'Restablecer' },
  'disp.done': { en: 'Done', es: 'Listo' },
  'switch.on': { en: 'On', es: 'Activado' },
  'switch.off': { en: 'Off', es: 'Desactivado' },
  'font.standard.label': { en: 'Standard (Open Sans)', es: 'Estándar (Open Sans)' },
  'font.standard.note': { en: 'The look of the rest of CypressWatch.', es: 'El estilo del resto de CypressWatch.' },
  'font.atkinson.note': { en: 'Letters that look alike are drawn differently.', es: 'Las letras parecidas se dibujan distinto.' },
  'font.lexend.note': { en: 'Wide, even letters that are easy to follow.', es: 'Letras anchas y parejas, fáciles de seguir.' },
  'font.opendyslexic.note': { en: 'Heavy bottoms on letters so they do not flip.', es: 'Letras con la base pesada para que no se den vuelta.' },
  'font.verdana.note': { en: 'Roomy and plain. Uses the phone font if Verdana is missing.', es: 'Amplia y sencilla. Usa la letra del teléfono si falta Verdana.' },

  // ---- sign-in and waiting screens
  'out.checkingTitle': { en: 'CypressWatch', es: 'CypressWatch' },
  'out.checking': { en: 'Checking your sign-in...', es: 'Verificando su inicio de sesión...' },
  'out.title': { en: 'Sign in to open your site', es: 'Inicie sesión para abrir su sitio' },
  'out.why': { en: 'Your supervisor needs to know who is on site. Sign in once with Google. After that, the app opens without signal.', es: 'Su supervisor necesita saber quién está en el sitio. Inicie sesión una vez con Google. Después, la aplicación abre sin señal.' },
  'out.noSignal': { en: 'No signal. Connect to the internet once to sign in.', es: 'Sin señal. Conéctese a internet una vez para iniciar sesión.' },
  'out.google': { en: 'Sign in with Google', es: 'Iniciar sesión con Google' },
  'wait.findingTitle': { en: 'Finding your site', es: 'Buscando su sitio' },
  'wait.finding': { en: 'Checking which site you work at...', es: 'Verificando en qué sitio trabaja...' },
  'wait.findingOffline': { en: 'No signal. Connect once so the app can find your site.', es: 'Sin señal. Conéctese una vez para que la aplicación encuentre su sitio.' },
  'wait.noneTitle': { en: 'No site assigned yet', es: 'Todavía no tiene un sitio asignado' },
  'wait.noneAdmin': { en: 'You are an admin. Assign yourself and your crew to sites on the Team tab.', es: 'Usted es administrador. Asígnese a usted y a su cuadrilla a sitios en la pestaña Equipo.' },
  'wait.noneCrew': { en: 'Ask your supervisor to assign you to a site. This page updates by itself once they do.', es: 'Pida a su supervisor que le asigne un sitio. Esta página se actualiza sola cuando lo haga.' },
  'wait.openTeam': { en: 'Open Team', es: 'Abrir Equipo' },

  // ---- site (home)
  'home.loadingTitle': { en: 'Your site', es: 'Su sitio' },
  'home.loading': { en: 'Loading your site...', es: 'Cargando su sitio...' },
  'home.failed': { en: 'Could not load your site.', es: 'No se pudo cargar su sitio.' },
  'home.retry': { en: 'Try again', es: 'Intentar de nuevo' },
  'home.eyebrow': { en: 'Your site · {county} County, {state}', es: 'Su sitio · Condado de {county}, {state}' },
  'home.score': { en: 'Hazard score today', es: 'Índice de riesgo de hoy' },
  'home.rank': { en: 'Site rank {rank} (1 = highest risk)', es: 'Posición del sitio: {rank} (1 = mayor riesgo)' },
  'home.raises': { en: 'raises risk', es: 'aumenta el riesgo' },
  'home.lowers': { en: 'lowers risk', es: 'reduce el riesgo' },
  'home.hazards': { en: 'Hazards at your site', es: 'Peligros en su sitio' },
  'home.conditions': { en: 'Conditions right now', es: 'Condiciones en este momento' },
  'home.heat': { en: 'Heat index', es: 'Índice de calor' },
  'home.gusts': { en: 'Wind gusts', es: 'Ráfagas de viento' },
  'home.rain': { en: 'Rain, last 24 h', es: 'Lluvia, últimas 24 h' },
  'home.soil': { en: 'Soil moisture', es: 'Humedad del suelo' },
  'home.noData': { en: 'No data', es: 'Sin datos' },
  'home.source': { en: 'Source: {source}, observed {time} {tz}', es: 'Fuente: {source}, observado a las {time} {tz}' },
  'home.disclaimer': { en: "Decision support only. Follow your company's safety procedures and your supervisor's direction.", es: 'Solo es una ayuda para decidir. Siga los procedimientos de seguridad de su empresa y las indicaciones de su supervisor.' },
  // safety
  'stop.title': { en: 'STOP WORK', es: 'DETENGA EL TRABAJO' },
  'stop.why': { en: 'Lightning within 10 miles. Shelter now.', es: 'Rayos a menos de 10 millas. Refúgiese ahora.' },
  'stop.clear': { en: 'All clear at {time} {tz} if there are no new strikes. Every new strike restarts the 30 minutes.', es: 'Podrá reanudar a las {time} {tz} si no hay más rayos. Cada rayo nuevo reinicia los 30 minutos.' },
  'stop.nearest': { en: 'Nearest strike {miles} miles away. {n} in the last 30 minutes.', es: 'El rayo más cercano cayó a {miles} millas. {n} en los últimos 30 minutos.' },
  'stop.nearest.one': { en: '1 strike', es: '1 rayo' },
  'stop.nearest.many': { en: '{n} strikes', es: '{n} rayos' },
  'stop.simulated': { en: 'Simulated strike (demo)', es: 'Rayo simulado (demostración)' },
  'stop.offline': { en: 'No signal. This clock keeps running, but new strikes will not show until signal returns.', es: 'Sin señal. Este reloj sigue contando, pero los rayos nuevos no se verán hasta que vuelva la señal.' },
  'stop.confirmed': { en: '{n} confirmed stopped: {names}', es: 'Pararon el trabajo ({n}): {names}' },
  'stop.crewMember': { en: 'A crew member', es: 'Un compañero' },
  'stop.youConfirmed': { en: 'You confirmed at {time}', es: 'Usted confirmó a las {time}' },
  'stop.sendsLater': { en: '. Sends when signal returns.', es: '. Se envía cuando vuelva la señal.' },
  'stop.iStopped': { en: 'I have stopped work', es: 'Ya paré el trabajo' },
  'stop.doneTitle': { en: 'Countdown finished', es: 'Terminó la cuenta regresiva' },
  'stop.doneBody': { en: 'Last strike {ago}. The 30 minutes ended at {time} {tz}.', es: 'Último rayo: {ago}. Los 30 minutos terminaron a las {time} {tz}.' },
  'stop.waitSup': { en: 'Wait for your supervisor to say work can restart.', es: 'Espere a que su supervisor diga que se puede reanudar el trabajo.' },
  'stop.waitSupOffline': { en: 'No signal, so new strikes cannot be seen. Check with your supervisor before restarting work.', es: 'Sin señal, así que no se pueden ver rayos nuevos. Consulte con su supervisor antes de reanudar el trabajo.' },
  'stop.noneTitle': { en: 'No stop-work right now', es: 'No hay que parar el trabajo ahora' },
  'stop.noneBody': { en: 'No lightning within 10 miles of this site. This screen turns red with a 30-minute countdown if that changes.', es: 'No hay rayos a menos de 10 millas de este sitio. Esta pantalla se pone roja con una cuenta regresiva de 30 minutos si eso cambia.' },
  // demo controls
  'demo.title': { en: 'Demo controls (simulated)', es: 'Controles de demostración (simulados)' },
  'demo.note': { en: 'Only shown in demo mode. Nothing here touches real conditions. A simulated strike starts the countdown on every signed-in phone.', es: 'Solo se muestran en modo de demostración. Nada aquí afecta las condiciones reales. Un rayo simulado inicia la cuenta regresiva en todos los teléfonos con sesión iniciada.' },
  'demo.linkOn': { en: 'Live link to other phones: connected', es: 'Enlace en vivo con otros teléfonos: conectado' },
  'demo.linkOff': { en: 'Live link to other phones: not connected', es: 'Enlace en vivo con otros teléfonos: sin conexión' },
  'demo.strike': { en: 'Simulate a lightning strike', es: 'Simular un rayo' },
  'demo.shared': { en: 'Sent to every phone.', es: 'Enviado a todos los teléfonos.' },
  'demo.local': { en: 'Only on this phone. No live link right now, so other phones did not get it.', es: 'Solo en este teléfono. No hay enlace en vivo ahora, así que los otros teléfonos no lo recibieron.' },
  'demo.reset': { en: 'Reset demo (clears it for everyone at your site)', es: 'Reiniciar la demostración (se borra para todos en su sitio)' },

  // ---- 3D site view
  'view.storm': { en: 'Thunderstorms nearby', es: 'Tormentas eléctricas cerca' },
  'view.overcast': { en: 'Cloudy conditions', es: 'Condiciones nubladas' },
  'view.sunny': { en: 'Sunny conditions', es: 'Condiciones soleadas' },
  'view.ring': { en: '10-mile safety ring', es: 'Círculo de seguridad de 10 millas' },
  'view.stop': { en: 'stop work', es: 'detener el trabajo' },
  'view.clear': { en: 'all clear', es: 'sin peligro' },
  'view.aria': { en: '3D view of {name}: {label}; {state}; 10-mile perimeter; {n} recent {strikes}', es: 'Vista 3D de {name}: {label}; {state}; perímetro de 10 millas; {n} {strikes} recientes' },
  'view.strike': { en: 'strike', es: 'rayo' },
  'view.strikes': { en: 'strikes', es: 'rayos' },
  'view.loading': { en: 'Loading 3D site view...', es: 'Cargando vista 3D del sitio...' },
  'view.help': { en: 'Drag to turn the view. A picture of your site, not a map to scale. Strike distances are illustrative. Follow the countdown.', es: 'Arrastre para girar la vista. Es una imagen de su sitio, no un mapa a escala. Las distancias de los rayos son ilustrativas. Siga la cuenta regresiva.' },

  // ---- map
  'map.title': { en: 'Hazard map', es: 'Mapa de peligros' },
  'map.eyebrowNear': { en: 'Reports near you', es: 'Reportes cerca de usted' },
  'map.notLoaded': { en: 'The map is not loaded yet.', es: 'El mapa aún no se ha cargado.' },
  'map.titleSite': { en: '{name} map', es: 'Mapa de {name}' },
  'map.desc': { en: 'Your site and the hazard reports around it.', es: 'Su sitio y los reportes de peligros a su alrededor.' },
  'map.loading': { en: 'Loading map...', es: 'Cargando mapa...' },
  'map.legendStreet': { en: 'Numbered circles are reports. Dashed W circles are waiting to upload. Tap a report below to fly to it on the map.', es: 'Los círculos con número son reportes. Los círculos con W y línea punteada están esperando para subir. Toque un reporte abajo para ir a él en el mapa.' },
  'map.broken': { en: 'The street map could not load. Showing a simple drawing instead.', es: 'No se pudo cargar el mapa de calles. Se muestra un dibujo sencillo.' },
  'map.offlineDrawing': { en: 'No signal. Showing a simple drawing instead of the street map.', es: 'Sin señal. Se muestra un dibujo sencillo en lugar del mapa de calles.' },
  'map.svgLabel': { en: 'Map of hazard reports around {name}', es: 'Mapa de reportes de peligros alrededor de {name}' },
  'map.center': { en: 'Site center', es: 'Centro del sitio' },
  'map.legendDrawing': { en: 'Edge of map is about {feet} ft from site center. Numbered circles are reports. Dashed W circles are waiting to upload.', es: 'El borde del mapa está a unos {feet} pies del centro del sitio. Los círculos con número son reportes. Los círculos con W y línea punteada están esperando para subir.' },
  'map.near': { en: 'Reports near your site', es: 'Reportes cerca de su sitio' },
  'map.none': { en: 'No hazard reports yet. Use the Report tab to add one.', es: 'Todavía no hay reportes de peligros. Use la pestaña Reportar para agregar uno.' },
  'map.showReport': { en: 'Show report {n} on the map', es: 'Mostrar el reporte {n} en el mapa' },
  'map.showWaiting': { en: 'Show waiting report {n} on the map', es: 'Mostrar el reporte en espera {n} en el mapa' },
  'map.hazard': { en: 'Hazard', es: 'Peligro' },
  'map.sev.low': { en: 'Low severity', es: 'Gravedad baja' },
  'map.sev.medium': { en: 'Moderate severity', es: 'Gravedad moderada' },
  'map.sev.high': { en: 'High severity', es: 'Gravedad alta' },
  'map.sev.extreme': { en: 'Extreme severity', es: 'Gravedad extrema' },
  'map.sev.none': { en: 'Severity not set', es: 'Gravedad sin definir' },
  'map.ai': { en: 'AI suggestion: {text}', es: 'Sugerencia de la IA: {text}' },
  'map.by': { en: '{name}, {ago}.', es: '{name}, {ago}.' },
  'map.confirmed': { en: 'Confirmed by supervisor.', es: 'Confirmado por el supervisor.' },
  'map.dismissed': { en: 'Dismissed by supervisor.', es: 'Descartado por el supervisor.' },
  'map.review': { en: 'Waiting for supervisor review.', es: 'Esperando la revisión del supervisor.' },
  'map.waitingUpload': { en: 'Waiting to upload. It sends on its own when signal returns.', es: 'Esperando para subir. Se envía solo cuando vuelva la señal.' },
  'map.aria': { en: 'Street map of {name} and hazard reports near it', es: 'Mapa de calles de {name} y de los reportes de peligros cercanos' },
  'map.pop.score': { en: 'Hazard score {score} of 10 · {level}', es: 'Índice de riesgo {score} de 10 · {level}' },
  'map.pop.siteAria': { en: '{name}, hazard score {score}', es: '{name}, índice de riesgo {score}' },
  'map.pop.waiting': { en: 'Waiting to upload', es: 'Esperando para subir' },
  'map.pop.waitingN': { en: 'Waiting to upload ({n})', es: 'Esperando para subir ({n})' },
  'map.pop.report': { en: 'Report', es: 'Reporte' },
  'map.pop.reportN': { en: 'Report {n}', es: 'Reporte {n}' },

  // ---- report
  'rep.title': { en: 'Report a hazard', es: 'Reportar un peligro' },
  'rep.eyebrow': { en: 'Tell your supervisor', es: 'Avise a su supervisor' },
  'rep.notLoaded': { en: 'Your site is not loaded yet. Open the Site tab first.', es: 'Su sitio aún no se ha cargado. Abra primero la pestaña Sitio.' },
  'rep.needPhoto': { en: 'Take a photo first.', es: 'Primero tome una foto.' },
  'rep.needPin': { en: 'Tap the map to place the pin, or choose another way to set the location.', es: 'Toque el mapa para poner el marcador, o elija otra forma de indicar el lugar.' },
  'rep.sent': { en: 'Report sent to your team.', es: 'Reporte enviado a su equipo.' },
  'rep.saved': { en: 'Saved on this phone. It uploads on its own when signal returns.', es: 'Guardado en este teléfono. Se sube solo cuando vuelva la señal.' },
  'rep.s1': { en: '1. Photo', es: '1. Foto' },
  'rep.photoInput': { en: 'Take or choose a photo', es: 'Tomar o elegir una foto' },
  'rep.photoAlt': { en: 'Photo of the hazard you will report', es: 'Foto del peligro que va a reportar' },
  'rep.take': { en: 'Take photo', es: 'Tomar foto' },
  'rep.retake': { en: 'Retake photo', es: 'Tomar otra foto' },
  'rep.s2': { en: '2. What is it? (optional)', es: '2. ¿Qué es? (opcional)' },
  'rep.s3': { en: '3. Where is the hazard?', es: '3. ¿Dónde está el peligro?' },
  'rep.whereAria': { en: 'Where is the hazard?', es: '¿Dónde está el peligro?' },
  'rep.where.photo': { en: 'Where I took the photo', es: 'Donde tomé la foto' },
  'rep.where.now': { en: 'Where I am now', es: 'Donde estoy ahora' },
  'rep.where.map': { en: 'Choose on the map', es: 'Elegir en el mapa' },
  'rep.help.photoNone': { en: 'Saved the moment you take the photo.', es: 'Se guarda en el momento en que toma la foto.' },
  'rep.help.photoLocating': { en: 'Saving your location...', es: 'Guardando su ubicación...' },
  'rep.help.photoSaved': { en: 'Saved when you took the photo. Walking away will not move it.', es: 'Se guardó al tomar la foto. Si se aleja, no cambia.' },
  'rep.help.photoMissing': { en: 'Your phone did not give a location. Use another choice, or the pin goes to the site center.', es: 'Su teléfono no dio una ubicación. Use otra opción, o el marcador irá al centro del sitio.' },
  'rep.help.now': { en: 'Uses your location when you press send.', es: 'Usa su ubicación cuando oprima enviar.' },
  'rep.help.map': { en: 'Tap the spot yourself. Best if you have already moved away.', es: 'Toque usted mismo el lugar. Es lo mejor si ya se alejó.' },
  'rep.padLabel': { en: 'Simple drawing of your site. Tap where the hazard is.', es: 'Dibujo sencillo de su sitio. Toque donde está el peligro.' },
  'rep.pickerLabel': { en: 'Street map. Tap where the hazard is.', es: 'Mapa de calles. Toque donde está el peligro.' },
  'rep.pickerCenter': { en: 'Site center', es: 'Centro del sitio' },
  'rep.pickerPin': { en: 'Hazard location', es: 'Ubicación del peligro' },
  'rep.fallbackA': { en: 'The street map could not load.', es: 'No se pudo cargar el mapa de calles.' },
  'rep.fallbackB': { en: 'No signal.', es: 'Sin señal.' },
  'rep.fallbackC': { en: 'Tap this drawing of your site instead. Edge to edge is about 3,000 ft.', es: 'Toque este dibujo de su sitio. De un borde al otro hay unos 3,000 pies.' },
  'rep.pinPlaced': { en: 'Pin placed ({lat}, {lon}). Drag it or tap again to move it.', es: 'Marcador puesto ({lat}, {lon}). Arrástrelo o toque de nuevo para moverlo.' },
  'rep.pinTap': { en: 'Tap the map where the hazard is.', es: 'Toque el mapa donde está el peligro.' },
  'rep.clearPin': { en: 'Clear pin', es: 'Quitar marcador' },
  'rep.s4': { en: '4. Note (optional)', es: '4. Nota (opcional)' },
  'rep.placeholder': { en: 'Where exactly? Example: by the culvert next to pole 14', es: '¿Dónde exactamente? Ejemplo: junto a la alcantarilla al lado del poste 14' },
  'rep.saving': { en: 'Saving...', es: 'Guardando...' },
  'rep.send': { en: 'Send report', es: 'Enviar reporte' },
  'rep.saveOffline': { en: 'Save report (no signal)', es: 'Guardar reporte (sin señal)' },
  'rep.offlineNote': { en: 'No signal. The report is saved on this phone and uploads on its own when signal returns.', es: 'Sin señal. El reporte se guarda en este teléfono y se sube solo cuando vuelva la señal.' },
  'rep.waitingTitle': { en: 'Waiting to upload ({n})', es: 'Esperando para subir ({n})' },
  'rep.qReport': { en: 'Hazard report', es: 'Reporte de peligro' },
  'rep.qAck': { en: 'Stop-work confirmation', es: 'Confirmación de trabajo detenido' },
  'rep.tried': { en: '(tried {n}x)', es: '(se intentó {n} veces)' },

  // ---- team
  'team.title': { en: 'Team', es: 'Equipo' },
  'team.eyebrow': { en: 'Admin', es: 'Administrador' },
  'team.onlyAdmin': { en: 'Only an admin can assign sites.', es: 'Solo un administrador puede asignar sitios.' },
  'team.desc': { en: 'Choose the site each person works at. They see only that site.', es: 'Elija el sitio donde trabaja cada persona. Solo verán ese sitio.' },
  'team.offline': { en: 'No signal. You can assign sites once you are back online.', es: 'Sin señal. Podrá asignar sitios cuando vuelva a tener conexión.' },
  'team.sitesFailed': { en: 'Could not load the site list.', es: 'No se pudo cargar la lista de sitios.' },
  'team.saved': { en: 'Saved. {who} now works at {site}.', es: 'Guardado. {who} ahora trabaja en {site}.' },
  'team.savedNone': { en: 'Saved. {who} has no site.', es: 'Guardado. {who} no tiene sitio.' },
  'team.thisPerson': { en: 'This person', es: 'Esta persona' },
  'team.saveFailed': { en: 'Could not save. Check your signal and try again.', es: 'No se pudo guardar. Revise su señal e intente de nuevo.' },
  'team.loadingPeople': { en: 'Loading people...', es: 'Cargando personas...' },
  'team.nobody': { en: 'Nobody has signed in yet.', es: 'Nadie ha iniciado sesión todavía.' },
  'team.unnamed': { en: 'Unnamed', es: 'Sin nombre' },
  'team.site': { en: 'Site', es: 'Sitio' },
  'team.defaultSite': { en: 'Demo site (default)', es: 'Sitio de demostración (predeterminado)' },

  // ---- errors that come from the data layer
  'err.noSite': { en: 'No site is assigned to you yet.', es: 'Todavía no tiene un sitio asignado.' },
  'err.noSignalEmpty': { en: 'You have no signal and nothing is saved on this phone yet. Connect once so the app can save your site.', es: 'No tiene señal y todavía no hay nada guardado en este teléfono. Conéctese una vez para que la aplicación guarde su sitio.' },
  'err.unreachable': { en: 'Could not reach the server.', es: 'No se pudo conectar con el servidor.' },

  // ---- hazards and levels
  'hz.lightning': { en: 'Lightning', es: 'Rayos' },
  'hz.heat': { en: 'Heat', es: 'Calor' },
  'hz.storm': { en: 'Storm', es: 'Tormenta' },
  'hz.flood': { en: 'Flooding', es: 'Inundación' },
  'hz.soil_saturation': { en: 'Wet ground', es: 'Suelo mojado' },
  'hz.wildfire': { en: 'Wildfire', es: 'Incendio forestal' },
  'hz.wildlife': { en: 'Wildlife', es: 'Fauna silvestre' },
  'lv.low': { en: 'Low', es: 'Bajo' },
  'lv.moderate': { en: 'Moderate', es: 'Moderado' },
  'lv.high': { en: 'High', es: 'Alto' },
  'lv.extreme': { en: 'Extreme', es: 'Extremo' },

  // ---- time
  'time.now': { en: 'just now', es: 'ahora mismo' },
  'time.min': { en: '{n} min ago', es: 'hace {n} min' },
  'time.h': { en: '{n} h ago', es: 'hace {n} h' },
  'time.d': { en: '{n} d ago', es: 'hace {n} d' },
} as const

export type TKey = keyof typeof STR
export type TFn = (key: TKey, vars?: Record<string, string | number>) => string

export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  // A missing key shows the key itself instead of crashing the screen.
  let s: string = STR[key]?.[lang] ?? STR[key]?.en ?? String(key)
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}

/** `const { t, lang } = useT()` then `t('nav.site')`. Re-renders when the language changes. */
export function useT(): { t: TFn; lang: Lang } {
  const [lang] = useLanguage()
  return useMemo(() => ({ lang, t: (key, vars) => translate(lang, key, vars) }), [lang])
}

/** Same as translate but for code outside React (the language is read when it runs). */
export function tNow(lang: Lang): TFn {
  return (key, vars) => translate(lang, key, vars)
}

/** "just now", "12 min ago", "3 h ago": in the chosen language. */
export function agoText(min: number, lang: Lang): string {
  if (min < 1) return translate(lang, 'time.now')
  if (min < 60) return translate(lang, 'time.min', { n: min })
  const h = Math.floor(min / 60)
  return h < 24 ? translate(lang, 'time.h', { n: h }) : translate(lang, 'time.d', { n: Math.floor(h / 24) })
}

export const FONT_NOTE_KEY = {
  standard: 'font.standard.note',
  atkinson: 'font.atkinson.note',
  lexend: 'font.lexend.note',
  opendyslexic: 'font.opendyslexic.note',
  verdana: 'font.verdana.note',
} as const satisfies Record<string, TKey>
