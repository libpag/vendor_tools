# Vendor build overrides for third-party CMake projects.
#
# On CMake 3.15+, this file is injected via CMAKE_PROJECT_INCLUDE and is
# automatically included AFTER each project() call.
# On older CMake, its content is inserted directly into CMakeLists.txt after
# the project() call as a fallback.

# Disable install() and export() commands to prevent third-party libraries from
# installing files during vendor builds. We only need the build artifacts.
macro (install)
endmacro ()
macro (export)
endmacro ()

# When building for the web platform (Emscripten), shared libraries are not natively
# supported. However, some third-party libraries declare SHARED targets in their
# CMakeLists.txt. Setting this property prevents CMake from erroring out.
if (EMSCRIPTEN)
    set_property(GLOBAL PROPERTY TARGET_SUPPORTS_SHARED_LIBS true)
endif ()

# Windows MSVC-specific build settings.
if (MSVC)
    # use MT(d) or MD(d)
    # if you want to build MD(d), delete the last "DLL" word
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>DLL")
    # MP: multi-processor compilation
    set(MSVC_BUILD_FLAGS /MP)
    if (CMAKE_BUILD_TYPE STREQUAL "Debug")
        # Z7: pdb Z7 format
        list(APPEND MSVC_BUILD_FLAGS /Z7)
    endif ()
    add_compile_options("$<$<COMPILE_LANGUAGE:C>:${MSVC_BUILD_FLAGS}>")
    add_compile_options("$<$<COMPILE_LANGUAGE:CXX>:${MSVC_BUILD_FLAGS}>")
endif ()
