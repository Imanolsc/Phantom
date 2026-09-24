import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS' };
const reply = (data:unknown, status=200) => new Response(JSON.stringify(data), { status, headers:{...cors,'Content-Type':'application/json'} });
const usernameOK = (s:unknown): s is string => typeof s==='string' && /^[A-Za-z0-9._-]{3,32}$/.test(s);
const passwordOK = (s:unknown): s is string => typeof s==='string' && s.length>=10 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s);
const authEmail = (username:string) => `u-${btoa(username.toLowerCase()).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}@accounts.fuerza.app`;

Deno.serve(async req => {
  if (req.method==='OPTIONS') return new Response('ok',{headers:cors});
  try {
    const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, secret=Deno.env.get('SERVICE_ROLE_KEY')!;
    if (!url || !anon || !secret) return reply({error:'Faltan secretos de Supabase en la función.'},500);
    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const auth=req.headers.get('Authorization')||'';
    if (!auth.startsWith('Bearer ')) return reply({error:'Sesión no válida.'},401);
    const {data:{user},error:userError}=await admin.auth.getUser(auth.slice(7));
    if (userError || !user) return reply({error:'Sesión no válida.'},401);
    const {data:caller,error:profileError}=await admin.from('profiles').select('id,username,role').eq('id',user.id).single();
    if (profileError || !caller) return reply({error:'Perfil no encontrado.'},403);

    if (req.method==='PUT') {
      const body=await req.json();
      if (body.action==='update-self') {
        if (!usernameOK(body.username)) return reply({error:'El usuario debe tener entre 3 y 32 caracteres (letras, números, punto, guion o guion bajo).'},400);
        const {error}=await admin.from('profiles').update({username:body.username}).eq('id',user.id);
        if (error) return reply({error:error.code==='23505'?'Ese nombre de usuario ya existe.':error.message},400);
        const {error:emailError}=await admin.auth.admin.updateUserById(user.id,{email:authEmail(body.username),email_confirm:true,user_metadata:{...user.user_metadata,username:body.username}});
        if (emailError) return reply({error:'No se pudo actualizar el nombre de acceso.'},400);
        return reply({id:user.id,username:body.username,role:caller.role});
      }
      if (body.action==='change-own-password') {
        if (!passwordOK(body.newPassword)) return reply({error:'La contraseña debe tener 10 caracteres como mínimo, con mayúscula, minúscula y número.'},400);
        const check=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
        const {error:checkError}=await check.auth.signInWithPassword({email:user.email!,password:body.currentPassword});
        if (checkError) return reply({error:'La contraseña actual no es correcta.'},400);
        const {error}=await admin.auth.admin.updateUserById(user.id,{password:body.newPassword});
        if (error) return reply({error:error.message},400);
        return reply({ok:true});
      }
    }

    if (caller.role!=='Administrador') return reply({error:'No tienes permisos para administrar usuarios.'},403);
    if (req.method==='GET') {
      const {data,error}=await admin.from('profiles').select('id,username,role,created_at').order('created_at');
      if (error) throw error;
      return reply(data||[]);
    }
    if (req.method==='POST') {
      const b=await req.json();
      if (!usernameOK(b.username) || !passwordOK(b.password) || !['Administrador','Usuario'].includes(b.role)) return reply({error:'Revisa el usuario, el rol y la contraseña (mínimo 10 caracteres, mayúscula, minúscula y número).'},400);
      const {data,error}=await admin.auth.admin.createUser({email:authEmail(b.username),password:b.password,email_confirm:true,user_metadata:{username:b.username}});
      if (error) return reply({error:error.message.includes('already')?'Ese usuario ya existe.':error.message},400);
      if (b.role==='Administrador') { const {error:e}=await admin.from('profiles').update({role:b.role}).eq('id',data.user.id); if(e) throw e; }
      return reply({id:data.user.id,username:b.username,role:b.role},201);
    }
    if (req.method==='PUT') {
      const b=await req.json(); if(b.action!=='update-user') return reply({error:'Acción no válida.'},400);
      if (!usernameOK(b.username) || !['Administrador','Usuario'].includes(b.role)) return reply({error:'Usuario o rol no válido.'},400);
      const targetId=String(b.id||''); const {data:target,error:targetError}=await admin.from('profiles').select('id,username,role').eq('id',targetId).single();
      if(targetError || !target) return reply({error:'Usuario no encontrado.'},404);
      if (b.password || b.newPassword) { const pass=b.newPassword||b.password; if(!passwordOK(pass)) return reply({error:'La contraseña debe tener 10 caracteres como mínimo, con mayúscula, minúscula y número.'},400); const {error}=await admin.auth.admin.updateUserById(targetId,{password:pass}); if(error) return reply({error:error.message},400); }
      if (target.role==='Administrador' && b.role!=='Administrador') { const {count,error}=await admin.from('profiles').select('*',{count:'exact',head:true}).eq('role','Administrador'); if(error) throw error; if((count||0)<=1) return reply({error:'No se puede quitar el último administrador.'},400); }
      if(target.username!==b.username) {
        const {error}=await admin.from('profiles').update({username:b.username}).eq('id',targetId);
        if(error) return reply({error:error.code==='23505'?'Ese nombre de usuario ya existe.':error.message},400);
        const {error:emailError}=await admin.auth.admin.updateUserById(targetId,{email:authEmail(b.username),email_confirm:true,user_metadata:{username:b.username}});
        if(emailError) return reply({error:'No se pudo actualizar el nombre de acceso.'},400);
      }
      const {error}=await admin.from('profiles').update({role:b.role}).eq('id',targetId); if(error) throw error;
      return reply({id:targetId,username:b.username,role:b.role});
    }
    if (req.method==='DELETE') {
      const id=new URL(req.url).searchParams.get('id'); if(!id) return reply({error:'Falta el usuario.'},400);
      if(id===user.id) return reply({error:'No puedes eliminar tu propia cuenta.'},400);
      const {data:target,error}=await admin.from('profiles').select('id,role').eq('id',id).single(); if(error||!target) return reply({error:'Usuario no encontrado.'},404);
      if(target.role==='Administrador') {const {count}=await admin.from('profiles').select('*',{count:'exact',head:true}).eq('role','Administrador'); if((count||0)<=1) return reply({error:'No se puede eliminar el último administrador.'},400);}
      const {error:deleteError}=await admin.auth.admin.deleteUser(id); if(deleteError) return reply({error:deleteError.message},400);
      return reply({ok:true});
    }
    return reply({error:'Método no permitido.'},405);
  } catch (e) { console.error(e); return reply({error:'Error interno al procesar la solicitud.'},500); }
});
