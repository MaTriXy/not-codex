import { isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Platform } from "react-native";

export const NATIVE_LIQUID_GLASS_SUPPORTED = Platform.OS === "ios" && isGlassEffectAPIAvailable();
