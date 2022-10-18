cmake_minimum_required(VERSION 3.15)

# use MT(d) or MD(d)
# if you want to build MD(d), delete the last "DLL" word
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
# multi compile
add_compile_options(/MP)
# embed the debug info within lib
add_compile_options(/Z7)
