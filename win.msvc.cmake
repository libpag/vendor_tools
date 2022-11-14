cmake_minimum_required(VERSION 3.15)

if (MSVC)
    message("MSVC build")
    # use MT(d) or MD(d)
    # if you want to build MD(d), delete the last "DLL" word
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
    
    # MP: # multi-processor compilation
    # Z7: pdb Z7 format
    set(MSVC_BUILD_FLAGS "/MP /Z7")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${MSVC_BUILD_FLAGS}")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${MSVC_BUILD_FLAGS}")
endif ()