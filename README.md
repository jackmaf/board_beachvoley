# 🏐 Voley Playa Scout - Sistema de Estadísticas en Tiempo Real

**Voley Playa Scout** es una aplicación web progresiva y ligera diseñada para entrenadores y analistas de voley playa (2 vs 2). Permite registrar cada punto del partido de forma táctil e interactiva, generando estadísticas automáticas y un mapa de calor para analizar el rendimiento de los jugadores.

![Voley Playa Scout](https://img.shields.io/badge/Versi%C3%B3n-1.0-orange?style=for-the-badge)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JS Vanilla](https://img.shields.io/badge/JS%20Vanilla-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

---

## 🚀 Características Principales

### 1. Configuración de Partido Personalizada
Antes de comenzar, puedes configurar:
- Nombres de los equipos (ej. Brasil vs España).
- Nombres específicos de los 4 jugadores (A1, A2, B1, B2).
- Persistencia: Si cierras el navegador, el partido actual se mantiene guardado.

### 2. Cancha Interactiva de Registro (8m x 16m)
Interface optimizada para tablets y móviles a pie de pista:
- **Captura de Coordenadas**: Haz clic exactamente donde cayó el balón.
- **Diferenciación de Acción**: Registra si fue un **Punto Ganador (Winner)** o un **Error No Forzado**.
- **Marcador Automático**: La lógica calcula el punto para el equipo correspondiente según la acción (si el Jugador A1 comete un error, el punto sube al Equipo B).

### 3. Panel de Estadísticas Avanzadas
Análisis profundo al finalizar o durante el partido:
- **Duración del Encuentro**: Calculada automáticamente desde el primer hasta el último punto.
- **Desglose de Eficiencia**:
    - Puntos ganadores por jugador.
    - Cantidad de errores por jugador.
    - Porcentaje de aporte al total de puntos del equipo.
- **Mapa de Calor (Heatmap)**: Visualización de la distribución de puntos en la cancha. Los errores se visualizan con un borde distintivo para identificar zonas de fallo.

### 4. Persistencia Local
- Utiliza **localStorage** para guardar el historial de partidos.
- Botón de **"Finalizar Partido"** que archiva el encuentro actual y prepara la app para el siguiente set o partido.

---

## 🛠️ Instalación y Uso

No requiere servidores ni bases de datos complejas. Es una solución "Serverless" pura.

1. Clona este repositorio:
   ```bash
   git clone https://github.com/tu-usuario/voley-playa-scout.git
   ```
2. Abre el archivo `index.html` en cualquier navegador moderno.
3. ¡Empieza a scoutear!

---

## 📱 Diseño y Estética

La aplicación utiliza un diseño **Glassmorphism** moderno con una paleta de colores deportiva:
- **Fondo**: Degradado inspirado en la arena y el mar.
- **Tipografía**: 'Outfit' para una lectura clara y profesional.
- **Responsividad**: Adaptable a cualquier pantalla mediante CSS Grid y Flexbox.

---

## 📄 Estructura del Proyecto

- `index.html`: Estructura semántica de las tres vistas (Config, Registro, Stats).
- `style.css`: Sistema de diseño, animaciones y estilos de la cancha.
- `app.js`: Lógica de estado, manejo de eventos y cálculos estadísticos.

---

## 💡 Futuras Mejoras (Roadmap)
- [ ] Exportación de datos a PDF o Excel.
- [ ] Registro de tipo de golpe (Saque, Remate, Bloqueo).
- [ ] Cronómetro de tiempos muertos.

---
Desarrollado con ❤️ para la comunidad de Voley Playa.
