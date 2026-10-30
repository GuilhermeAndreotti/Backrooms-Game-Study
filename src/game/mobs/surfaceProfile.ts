/** Material semantics shared by the GLB compiler and renderer. Never inferred from colour. */
export type CreatureSurface = "skin" | "flesh" | "cloth" | "leather" | "bone" | "chitin" | "rubber" | "none";

export function creatureSurface(name: string): CreatureSurface {
  if (/eye|hole|hollow|void|maw|badge|gold|ring|brass|stripe|cuff|band|mouth|sheen/.test(name)) return "none";
  if (/alien_(hide|bone)/.test(name)) return "chitin";
  if (/teeth|bone|claw|nail|blade/.test(name)) return "bone";
  if (/wretch_(skin|head)|clump_(core|vein)|hound_jaw/.test(name)) return "flesh";
  if (/skin_stealer_body|stealer_(suit|hood)|imitador_(body|jacket)|king2_(suit|shirt|tie)|bellman_(cloth|black)|ceifador_hood|vigia_(trunks|strap)|_(coat|robe|ermine|glove|hat)$/.test(name)) return "cloth";
  if (/boot|shoe|stealer_trim/.test(name)) return "leather";
  if (/^(anim|king)_(body|face)$|sombra_body|vigia_float/.test(name)) return "rubber";
  if (/skin|head|body|hide|limb|knuckle|lid/.test(name)) return "skin";
  return "none";
}

export const SURFACE_SCALE: Record<CreatureSurface, number> = {
  skin: 3.4, flesh: 3, cloth: 5, leather: 5, bone: 8, chitin: 4, rubber: 4, none: 1,
};

/** Restore natural midtones: detail must survive the flashlight, not glow to be visible. */
export const CREATURE_COLORS: Record<string, number> = {
  hound_body: 0x827367, hound_head: 0x74665d, hound_jaw: 0x7f3c37,
  wretch_skin: 0x995b51, wretch_head: 0x9c7161,
  eco_body: 0x8b8584, observador_skin: 0x777584, observador_lid: 0x5b353d,
  vigia_skin: 0x8d9a98, vigia_limb: 0x7f8c8a, vigia_trunks: 0x6e2a25, vigia_float: 0xa4432f,
  clump_core: 0x925752, clump_vein: 0x593637,
  alien_hide: 0x343c43, alien_bone: 0x4a5056,
};
