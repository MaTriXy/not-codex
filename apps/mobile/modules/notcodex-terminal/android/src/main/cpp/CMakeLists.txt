cmake_minimum_required(VERSION 3.22.1)

project(notcodexterminal LANGUAGES CXX)

add_library(ghostty-vt SHARED IMPORTED)
set_target_properties(
  ghostty-vt
  PROPERTIES IMPORTED_LOCATION
             "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libghostty-vt.so"
)

add_library(notcodexterminal SHARED notcodex_terminal_jni.cpp)

target_include_directories(
  notcodexterminal
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../../../../Vendor/libghostty-vt/include"
)

target_link_options(
  notcodexterminal PRIVATE "-Wl,-z,common-page-size=16384" "-Wl,-z,max-page-size=16384"
)

target_link_libraries(notcodexterminal PRIVATE ghostty-vt log)
