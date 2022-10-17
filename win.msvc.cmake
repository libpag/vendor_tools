cmake_minimum_required(VERSION 3.15)

# use MT(d), if want to build MD(d) comment this command
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
# multi compile
add_compile_options(/MP)
# embed the debug info within lib
add_compile_options(/Z7)
