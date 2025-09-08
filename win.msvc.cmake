cmake_minimum_required(VERSION 3.15)

# use MT(d) or MD(d)
# if you want to build MD(d), delete the last "DLL" word
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
if (MSVC)
    message("MSVC build")
    # MP: # multi-processor compilation
    set(MSVC_BUILD_FLAGS /MP)
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        # Z7: pdb Z7 format
        list(APPEND MSVC_BUILD_FLAGS /Z7)
    endif()
    add_compile_options("$<$<COMPILE_LANGUAGE:C>:${MSVC_BUILD_FLAGS}>")
    add_compile_options("$<$<COMPILE_LANGUAGE:CXX>:${MSVC_BUILD_FLAGS}>")
endif ()
