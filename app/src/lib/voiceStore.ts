import { Directory, File, Paths } from 'expo-file-system'
import { supabase } from './supabase'

// Голосовые записи не должны теряться: запись лежит в постоянной папке телефона,
// пока сервер её не разобрал, и сохраняется в Supabase Storage (бакет voice/<user>/…).

const SUB = ['ExpoAudio', 'Audio'] // iOS / Android — куда expo-audio кладёт записи

export type PendingRecording = { file: File; name: string; size: number; at: number }

function audioFiles(root: Directory): File[] {
  const out: File[] = []
  for (const sub of SUB) {
    const dir = new Directory(root, sub)
    if (!dir.exists) continue
    for (const f of dir.list()) if (f instanceof File && /\.(m4a|mp4|aac|caf)$/i.test(f.name)) out.push(f)
  }
  return out
}

// Неразобранные записи. Записи из кэша (старые, до этой версии) переносим в постоянную папку,
// чтобы система их не стёрла.
export function pendingRecordings(): PendingRecording[] {
  const safe = new Directory(Paths.document, 'ExpoAudio')
  try {
    for (const f of audioFiles(Paths.cache)) {
      if (!f.size) continue
      if (!safe.exists) safe.create({ intermediates: true })
      f.moveSync(new File(safe, f.name))
    }
  } catch (e) {
    console.warn('voice: не удалось перенести запись из кэша', e)
  }
  return audioFiles(Paths.document)
    .filter((f) => f.size > 0)
    .map((f) => ({ file: f, name: f.name, size: f.size, at: f.modificationTime ?? f.creationTime ?? 0 }))
    .sort((a, b) => b.at - a.at)
}

// Загрузить запись в Storage (повторная загрузка того же файла просто перезапишет его)
export async function uploadRecording(file: File, userId: string): Promise<string> {
  const path = `${userId}/${file.name}`
  const { error } = await supabase.storage.from('voice')
    .upload(path, await file.arrayBuffer(), { contentType: 'audio/mp4', upsert: true })
  if (error) throw new Error(`Не удалось сохранить запись: ${error.message}`)
  return path
}

// Сервер разобрал — копия есть в Storage, с телефона можно убрать
export function forgetRecording(file: File) {
  try { if (file.exists) file.delete() } catch {}
}
