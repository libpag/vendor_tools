#!/bin/bash -e

find_ndk() {
  for NDK in $NDK_HOME $NDK_PATH $ANDROID_NDK_HOME $ANDROID_NDK; do
    if [ -f "$NDK/ndk-build" ]; then
      echo $NDK
      return
    fi
  done
  ANDROID_HOME=$HOME/Library/Android/sdk
  if [ -f "$ANDROID_HOME/ndk-bundle/ndk-build" ]; then
    echo $ANDROID_HOME/ndk-bundle
    return
  fi

  if [ -d "$ANDROID_HOME/ndk" ]; then
    for file in $ANDROID_HOME/ndk/*; do
      if [ -f "$file/ndk-build" ]; then
        echo $file
        return
      fi
    done
  fi
}

function brew_check() {
  for TOOL in "$@"; do
    if [ ! $(which $TOOL) ]; then
      if [ ! $(which brew) ]; then
        echo "Homebrew not found. Trying to install..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" ||
          exit 1
      fi
      echo "$TOOL not found. Trying to install..."
      brew install $TOOL || exit 1
    fi
  done
}

print_copy_library_help() {
  echo ""
  echo 'Usage: copy_library -p android -i ./include/. -l "arm=./armv7/lib/*.a;arm64=./arm64/lib/*.a"'
  echo "Options:"
  echo "-p The platform of this library."
  echo "-i The header files need to be copied."
  echo "-l The library files need to be copied."
  echo ""
  exit 1
}

function copy_library() {
  while getopts "p:i:l:" opt; do
    case "$opt" in
    p) platform="$OPTARG" ;;
    i) includes="$OPTARG" ;;
    l) libraries="$OPTARG" ;;
    *) print_copy_library_help ;;
    esac
  done
  OLD_IFS="$IFS"
  IFS=";"
  list=($libraries)
  IFS="$OLD_IFS"

  if [[ ${VENDOR_OUT_DIR} == "" ]]; then
    LIB_OUT_DIR=$(pwd)/out/${platform}
  else
    LIB_OUT_DIR=${VENDOR_OUT_DIR}/${platform}
  fi
  rm -rf ${LIB_OUT_DIR}
  mkdir -p ${LIB_OUT_DIR}

  for item in ${list[@]}; do
    arch=${item%=*}
    files=${item#*=}
    mkdir -p ${LIB_OUT_DIR}/${arch}
    cp -rf ${files} ${LIB_OUT_DIR}/${arch}
  done

  if [[ ${includes} != "" ]]; then
    INPUT_FILES=${VENDOR_INCLUDE}
    mkdir -p ${LIB_OUT_DIR}/include
    cp -rf ${includes} ${LIB_OUT_DIR}/include
  fi
}
