cmake_minimum_required(VERSION 3.15)

if (MSVC)
    # use MT(d) or MD(d)
    # if you want to build MD(d), delete the last "DLL" word
    message("MSVC build")
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
    # MP: # multi-processor compilation
    # Z7: pdb Z7 format
    set(MSVC_BUILD_FLAGS /MP /Z7)
    add_compile_options("$<$<COMPILE_LANGUAGE:C>:${MSVC_BUILD_FLAGS}>")
    add_compile_options("$<$<COMPILE_LANGUAGE:CXX>:${MSVC_BUILD_FLAGS}>")
endif ()

# open arch:avx
add_compile_options(/arch:AVX)