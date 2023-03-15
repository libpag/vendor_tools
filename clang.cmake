cmake_minimum_required(VERSION 3.17)

# use clang toolchain
set(CMAKE_CXX_COMPILER Clang++)
set(CMAKE_C_COMPILER Clang)
set(CLANG_BUILD_FLAGS "${CLANG_BUILD_FLAGS} -Zi")

if($ENV{VSCMD_ARG_TGT_ARCH} STREQUAL "x64")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -m64")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -m64")
elseif($ENV{VSCMD_ARG_TGT_ARCH} STREQUAL "x86")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -m32")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -m32")
endif()
