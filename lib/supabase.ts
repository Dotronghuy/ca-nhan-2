import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://makktwitwpowupmqqulb.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_RxOd8zl9t6bUX92tOqwBFA_MF1e1UNL";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export type SupabaseMediaItem = {
  id: string;
  name: string;
  kind: "image" | "video";
  url: string;
  mime_type?: string;
  width?: number;
  height?: number;
  duration?: number;
  special: boolean;
  created_at: number;
};

// Upload Blob/File to Supabase Storage and return public URL
export async function uploadToSupabaseStorage(
  fileOrBlob: Blob | File,
  filename: string,
  contentType?: string
): Promise<string> {
  const filePath = `uploads/${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  
  const { data, error } = await supabase.storage
    .from("media-storage")
    .upload(filePath, fileOrBlob, {
      contentType: contentType || fileOrBlob.type || "application/octet-stream",
      upsert: true,
    });

  if (error) {
    console.error("Supabase storage upload error:", error);
    throw error;
  }

  const { data: publicUrlData } = supabase.storage
    .from("media-storage")
    .getPublicUrl(data.path);

  return publicUrlData.publicUrl;
}

// Fetch all media items from Supabase
export async function fetchSupabaseMedia(): Promise<SupabaseMediaItem[]> {
  const { data, error } = await supabase
    .from("gallery_media")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Fetch Supabase media error:", error);
    return [];
  }
  return (data || []) as SupabaseMediaItem[];
}

// Insert new media item into Supabase
export async function insertSupabaseMedia(item: SupabaseMediaItem): Promise<void> {
  const { error } = await supabase.from("gallery_media").insert(item);
  if (error) {
    console.error("Insert Supabase media error:", error);
  }
}

// Toggle or update special (favorite / thả tim) flag
export async function updateSupabaseMediaSpecial(id: string, special: boolean): Promise<void> {
  const { error } = await supabase
    .from("gallery_media")
    .update({ special })
    .eq("id", id);

  if (error) {
    console.error("Update Supabase media special error:", error);
  }
}

// Delete media item from Supabase
export async function deleteSupabaseMedia(id: string): Promise<void> {
  const { error } = await supabase.from("gallery_media").delete().eq("id", id);
  if (error) {
    console.error("Delete Supabase media error:", error);
  }
}

// Clear all media items from Supabase
export async function clearSupabaseMedia(): Promise<void> {
  const { error } = await supabase.from("gallery_media").delete().neq("id", "");
  if (error) {
    console.error("Clear Supabase media error:", error);
  }
}

// App Settings (Love Date, Polaroid, Voiceover)
export async function getSupabaseSetting(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .single();

  if (error || !data) return null;
  return data.value;
}

export async function setSupabaseSetting(key: string, value: string): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value });

  if (error) {
    console.error(`Set Supabase setting ${key} error:`, error);
  }
}
