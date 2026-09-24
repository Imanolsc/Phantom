# Fuerza — publicación en GitHub Pages

La aplicación se sirve como web estática desde `wwwroot/` mediante GitHub Pages. Supabase proporciona inicio de sesión y PostgreSQL persistente; el navegador no almacena los datos de entrenamiento (solo conserva la sesión de autenticación). Cada llamada a los datos está limitada por Row Level Security (RLS). La gestión de usuarios usa una Edge Function protegida y su clave privada nunca se publica.

## Preparar Supabase

1. Crea un proyecto en Supabase y guarda en un gestor seguro las claves del proyecto.
2. En **SQL Editor**, ejecuta el contenido completo de [`supabase/schema.sql`](supabase/schema.sql). El script crea perfiles, relaciones normalizadas, guardado del espacio de entrenamiento y políticas RLS por usuario.
3. En **Authentication → Providers → Email**, desactiva **Allow new users to sign up**. No hay registro público: las cuentas se crean desde Administración.
4. Para que GitHub despliegue las funciones automáticamente, en el repositorio abre **Settings → Secrets and variables → Actions** y crea estos secretos:

   - `SUPABASE_ACCESS_TOKEN`: crea un Personal Access Token desde el panel de Supabase. Guárdalo solo como secreto de GitHub; no lo compartas ni lo pongas en archivos.
   - `SUPABASE_PROJECT_ID`: `pyekewhfoqvvwmlnuswx`.

   El workflow [`.github/workflows/supabase-functions.yml`](.github/workflows/supabase-functions.yml) instala y ejecuta la CLI dentro de GitHub Actions al subir cambios. No tienes que instalarla en tu portátil.

5. En Supabase, abre **Edge Functions → Secrets** (o **Project Settings → Edge Functions → Secrets**) y guarda allí `SERVICE_ROLE_KEY` con la clave privada `service_role`/`secret`. No la añadas a archivos ni a GitHub. Añade también allí `BOOTSTRAP_ADMIN_SECRET`, usando una frase aleatoria larga temporal.

6. Después del primer push, GitHub Actions habrá desplegado `bootstrap-admin`. En Supabase ve a **Edge Functions → bootstrap-admin → Test**, selecciona `POST` y manda un cuerpo JSON con el secreto temporal y tus credenciales iniciales, por ejemplo:

   ```json
   {"secret":"EL_SECRETO_TEMPORAL_QUE_CONFIGURASTE","username":"admin","password":"TU_CONTRASEÑA_FUERTE"}
   ```

   El endpoint solo crea el primer administrador y rechaza nuevas inicializaciones cuando ya hay uno. Después, elimina `BOOTSTRAP_ADMIN_SECRET` desde la pantalla de secretos de Supabase. La cuenta inicial seguirá funcionando.

   Las cuentas usan un alias interno para inicio de sesión, no se envían correos. El usuario inicia sesión con el nombre y contraseña habituales.

7. La URL y la clave pública del proyecto Phantom ya están puestas en [`wwwroot/supabase-config.js`](wwwroot/supabase-config.js). Esa clave pública se incluye en el sitio; RLS protege los datos. Nunca copies allí `service_role`/`secret`.

## Publicar en GitHub Pages

El workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publica únicamente `wwwroot/` al hacer push a `main`.

1. Sube el proyecto a GitHub.
2. En el repositorio, abre **Settings → Pages** y selecciona **GitHub Actions** como fuente.
3. Comprueba la ejecución en **Actions**. La URL será `https://USUARIO.github.io/REPOSITORIO/` (o tu dominio configurado en Pages).
4. En Supabase **Authentication → URL Configuration**, añade la URL publicada a **Site URL** y a **Redirect URLs**. Aunque no se usa registro/correo, así queda permitida la dirección del sitio.

Pages solo aloja archivos estáticos; no ejecuta .NET, una API propia ni SQLite. GitHub contiene el código, pero los datos compartidos viven en el proyecto PostgreSQL de Supabase. Por tanto, cualquier dispositivo conserva el mismo historial al iniciar sesión.

## Seguridad y datos

- Los roles son únicamente `Administrador` y `Usuario`; el servidor valida acciones administrativas en `manage-users`.
- RLS limita perfiles y tablas de entrenamiento al propietario autenticado. Un usuario estándar no puede consultar o cambiar datos ajenos, aunque manipule las peticiones del navegador.
- La clave pública de Supabase está diseñada para cliente; la clave `service_role` se guarda únicamente en los secretos de Edge Functions.
- No hay límite de usuarios implementado por la aplicación. El límite práctico dependerá del plan/capacidad del proyecto Supabase.
- Exporta periódicamente los datos desde Supabase. Consulta las condiciones actuales del plan elegido antes de depender de retención, copias de seguridad o disponibilidad.

## Prueba local

Una vez configurado Supabase, puedes servir `wwwroot/` con cualquier servidor estático local (no abras `index.html` directamente desde `file://`, porque el navegador bloquea llamadas de red). Por ejemplo, con Node instalado:

```powershell
npx http-server wwwroot -p 8080
```

Abre `http://localhost:8080`. No se necesita IIS ni instalar una base de datos en el dispositivo.
