import { createClient } from 'npm:@supabase/supabase-js@2';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return reply({error:'Método no permitido.'},405);
  try {
    const body=await req.json(), expected=Deno.env.get('BOOTSTRAP_ADMIN_SECRET');
    if(!expected || body.secret!==expected) return reply({error:'Secreto de configuración no válido.'},403);
    if(typeof body.username!=='string'||!/^[A-Za-z0-9._-]{3,32}$/.test(body.username)||typeof body.password!=='string'||body.password.length<10||!/[A-Z]/.test(body.password)||!/[a-z]/.test(body.password)||!/[0-9]/.test(body.password)) return reply({error:'Usuario o contraseña no válidos.'},400);
    const url=Deno.env.get('SUPABASE_URL')!, key=Deno.env.get('SERVICE_ROLE_KEY')!;
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {count,error:countError}=await admin.from('profiles').select('*',{count:'exact',head:true}).eq('role','Administrador');
    if(countError) throw countError;
    if((count||0)>0) return reply({error:'Ya existe un administrador. El acceso de configuración está cerrado.'},409);
    const email=`u-${btoa(body.username.toLowerCase()).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}@accounts.fuerza.app`;
    const {data,error}=await admin.auth.admin.createUser({email,password:body.password,email_confirm:true,user_metadata:{username:body.username}});
    if(error) return reply({error:error.message},400);
    const {error:roleError}=await admin.from('profiles').update({role:'Administrador'}).eq('id',data.user.id);
    if(roleError) throw roleError;
    return reply({ok:true,username:body.username,message:'Administrador creado. El endpoint de inicialización ya no volverá a aceptar solicitudes.'},201);
  } catch(e) { console.error(e); return reply({error:'No se pudo inicializar el administrador.'},500); }
});
