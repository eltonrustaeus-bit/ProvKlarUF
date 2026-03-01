import { createClient } from "@supabase/supabase-js";

export default async function handler(req,res){

try{

if(req.method !== "POST"){
return res.status(405).json({error:"Method not allowed"});
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if(!SUPABASE_URL || !SERVICE_KEY){
return res.status(500).json({
error:"Missing Supabase env variables"
});
}

const supabase = createClient(
SUPABASE_URL,
SERVICE_KEY
);

const {user_id} = req.body || {};

if(!user_id){
return res.status(400).json({
error:"Missing user_id"
});
}

const {data,error} = await supabase
.from("user_roles")
.select("role")
.eq("user_id",user_id)
.maybeSingle();

if(error){
return res.status(500).json({
error:error.message
});
}

if(!data){
return res.status(200).json({
role:"basic"
});
}

return res.status(200).json({
role:data.role
});

}
catch(e){

return res.status(500).json({
error:String(e)
});

}

}
