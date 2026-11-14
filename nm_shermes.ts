//! Static Hermes Native Messaging host
//! guest271314, 10-2-2035
"use strict";

(function (exports) {
  const STDIN_FD: number = 0;
  const STDOUT_FD: number = 1;
  const STDERR_FD: number = 2;
  const HEADER_SIZE: number = 4;
  const COMMA: number = 44;
  const OPEN_BRACKET: number = 91;
  const CLOSE_BRACKET: number = 93;

  const CHUNK_SIZE: number = 1024 * 1024;
  const STREAM_BUFFER_SIZE: number = CHUNK_SIZE * 2;
  const UTILITY_BUFFER_SIZE: number = 4096;
  const SEARCH_BACKTRACK: number = CHUNK_SIZE - 8;

  // --- FFI Bindings ---
  const read_fd = $SHBuiltin.extern_c(
    { include: "nm_shermes.h" },
    function c_read_fd(
      fd: c_int,
      ptr: c_ptr,
      offset: c_size_t,
      len: c_size_t,
    ): c_int {
      throw 0;
    },
  );

  const write_fd = $SHBuiltin.extern_c(
    { include: "nm_shermes.h" },
    function c_write_fd(
      fd: c_int,
      ptr: c_ptr,
      offset: c_size_t,
      len: c_size_t,
    ): c_int {
      throw 0;
    },
  );

  const get_byte = $SHBuiltin.extern_c(
    { include: "nm_shermes.h" },
    function c_get_byte(ptr: c_ptr, offset: c_size_t): c_int {
      throw 0;
    },
  );

  const set_byte = $SHBuiltin.extern_c(
    { include: "nm_shermes.h" },
    function c_set_byte(ptr: c_ptr, offset: c_size_t, value: c_int): void {
      throw 0;
    },
  );

  const ptr_add = $SHBuiltin.extern_c(
    { include: "nm_shermes.h" },
    function c_ptr_add(ptr: c_ptr, offset: c_size_t): c_ptr {
      throw 0;
    },
  );

  const copy_bytes = $SHBuiltin.extern_c(
    { include: "nm_shermes.h" },
    function c_copy(
      dst: c_ptr,
      dst_off: c_size_t,
      src: c_ptr,
      src_off: c_size_t,
      n: c_size_t,
    ): void {
      throw 0;
    },
  );

  const move_bytes = $SHBuiltin.extern_c(
    { include: "nm_shermes.h" },
    function c_move(
      dst: c_ptr,
      dst_off: c_size_t,
      src: c_ptr,
      src_off: c_size_t,
      n: c_size_t,
    ): void {
      throw 0;
    },
  );

  const index_of = $SHBuiltin.extern_c(
    { include: "nm_shermes.h" },
    function c_index_of(
      base: c_ptr,
      start: c_size_t,
      end: c_size_t,
      ch: c_int,
    ): c_int {
      throw 0;
    },
  );

  const c_malloc = $SHBuiltin.extern_c(
    { include: "stdlib.h" },
    function malloc(size: c_size_t): c_ptr {
      throw 0;
    },
  );

  const c_exit = $SHBuiltin.extern_c(
    { include: "stdlib.h" },
    function exit(code: c_int): void {
      throw 0;
    },
  );

  class SystemIO {
    read(
      fd: number,
      view: c_ptr,
      offset: number,
      len: number,
    ): number {
      const res: number = read_fd(fd, view, offset, len);
      return res;
    }

    write(
      fd: number,
      view: c_ptr,
      offset: number,
      len: number,
    ): number {
      const res: number = write_fd(fd, view, offset, len);
      return res;
    }
  }

  class NativeHostPipeline {
    io: SystemIO = new SystemIO();
    // frame: [0..4) outgoing length header | [4..) body window | 1 spare byte.
    // body is frame + HEADER_SIZE, so input is read in place and each chunk is
    // framed in place and sent with a single write.
    frame: c_ptr = c_malloc(HEADER_SIZE + STREAM_BUFFER_SIZE + 1);
    header: c_ptr = c_malloc(HEADER_SIZE);
    util: c_ptr = c_malloc(UTILITY_BUFFER_SIZE);

    readLengthFromHeader(): number {
      const h: c_ptr = this.header;
      const s0: number = get_byte(h, 0);
      const s1: number = get_byte(h, 1);
      const s2: number = get_byte(h, 2);
      const s3: number = get_byte(h, 3);
      return ((s0 | (s1 << 8) | (s2 << 16) | (s3 << 24)) >>> 0);
    }

    writeBuffer(
      fd: number,
      u8: c_ptr,
      offset: number,
      length: number,
    ): void {
      const end: number = offset + length;
      let position: number = offset;
      while (position < end) {
        const n: number = this.io.write(fd, u8, position, end - position);
        if (n <= 0) throw new Error("write returned 0");
        position = position + n;
      }
    }

    // One partial read into the body window; returns as soon as stdin has
    // any bytes so the caller can act on them immediately.
    readSome(offset: number, length: number): number {
      const n: number = this.io.read(
        STDIN_FD,
        this.frame,
        HEADER_SIZE + offset,
        length,
      );
      if (n <= 0) throw new Error("stdin closed prematurely");
      return n;
    }

    // The body is already in `frame`; write the length header in front, one write.
    emit(payload: number): void {
      const frame: c_ptr = this.frame;
      set_byte(frame, 0, payload & 255);
      set_byte(frame, 1, (payload >> 8) & 255);
      set_byte(frame, 2, (payload >> 16) & 255);
      set_byte(frame, 3, (payload >> 24) & 255);
      this.writeBuffer(STDOUT_FD, frame, 0, HEADER_SIZE + payload);
    }

    // Sends body[0, toIndex) as one framed message, fixing JSON brackets in place:
    //   leading ','  -> overwritten with '[' (same bytes as skip-comma + prepend '[')
    //   missing ']'  -> written into the byte just past the chunk, then restored
    sendChunk(toIndex: number): void {
      const body: c_ptr = ptr_add(this.frame, HEADER_SIZE);
      const startByte: number = get_byte(body, 0);
      const endByte: number = get_byte(body, toIndex - 1);

      let append: boolean = false;
      if (startByte === OPEN_BRACKET) {
        append = endByte !== CLOSE_BRACKET;
      } else if (startByte === COMMA) {
        set_byte(body, 0, OPEN_BRACKET);
        append = endByte !== CLOSE_BRACKET;
      }

      if (append) {
        // body[toIndex] is the next chunk's leading ',' or unused space.
        const saved: number = get_byte(body, toIndex);
        set_byte(body, toIndex, CLOSE_BRACKET);
        this.emit(toIndex + 1);
        set_byte(body, toIndex, saved);
      } else {
        this.emit(toIndex);
      }
    }

    streamIncomingMessage(totalIncomingBytes: number): void {
      let remainingBytes: number = totalIncomingBytes;
      let bufferPopulation: number = 0;
      let scanned: number = SEARCH_BACKTRACK; // [SEARCH_BACKTRACK, scanned) has no comma
      const body: c_ptr = ptr_add(this.frame, HEADER_SIZE);

      while (remainingBytes > 0 || bufferPopulation > 0) {
        // 1. Take whatever stdin has right now.
        if (remainingBytes > 0) {
          const space: number = STREAM_BUFFER_SIZE - bufferPopulation;
          const want: number = space < remainingBytes ? space : remainingBytes;
          const n: number = this.readSome(bufferPopulation, want);
          bufferPopulation = bufferPopulation + n;
          remainingBytes = remainingBytes - n;
        }

        // 2. Emit as soon as a full chunk boundary is available.
        if (bufferPopulation > CHUNK_SIZE) {
          let splitIndex: number = -1;

          // Only scan bytes not yet searched, so no byte is scanned twice.
          if (scanned < bufferPopulation) {
            const found: number = index_of(
              body,
              scanned,
              bufferPopulation,
              COMMA,
            );
            if (found !== -1) {
              splitIndex = found;
            } else {
              scanned = bufferPopulation;
            }
          }

          // No comma: split at CHUNK_SIZE once the window is full or input is done.
          if (
            splitIndex === -1 &&
            (remainingBytes === 0 || bufferPopulation === STREAM_BUFFER_SIZE)
          ) {
            splitIndex = CHUNK_SIZE;
          }

          if (splitIndex !== -1) {
            this.sendChunk(splitIndex);
            const remainingInWindow: number = bufferPopulation - splitIndex;
            if (remainingInWindow > 0) {
              move_bytes(body, 0, body, splitIndex, remainingInWindow);
            }
            bufferPopulation = remainingInWindow;
            scanned = SEARCH_BACKTRACK;
          }
        } else if (remainingBytes === 0) {
          // Whole message is in and fits in one chunk.
          if (bufferPopulation > 0) {
            this.sendChunk(bufferPopulation);
            bufferPopulation = 0;
          }
          break;
        }
      }
    }

    writeStringToUtilBuffer(str: string): number {
      const s: any = str;
      const len: number = s.length as number;
      const u: c_ptr = this.util;
      for (let i: number = 0; i < len; i++) {
        const cp: number = s.charCodeAt(i) as number;
        set_byte(u, i, cp);
      }
      return len;
    }

    writeManualErrorJson(msg: string): number {
      const u: c_ptr = this.util;
      let cursor: number = 0;
      set_byte(u, cursor++, 123); // {
      set_byte(u, cursor++, 34); // "
      set_byte(u, cursor++, 101); // e
      set_byte(u, cursor++, 114); // r
      set_byte(u, cursor++, 114); // r
      set_byte(u, cursor++, 111); // o
      set_byte(u, cursor++, 114); // r
      set_byte(u, cursor++, 34); // "
      set_byte(u, cursor++, 58); // :
      set_byte(u, cursor++, 34); // "

      const m: any = msg;
      const msgLen: number = m.length as number;
      for (let i: number = 0; i < msgLen; i++) {
        const cp: number = m.charCodeAt(i) as number;
        if (cp === 34 || cp === 92) {
          set_byte(u, cursor++, 92);
        }
        set_byte(u, cursor++, cp);
      }

      set_byte(u, cursor++, 34); // "
      set_byte(u, cursor++, 125); // }
      return cursor;
    }

    handleCrash(msg: string): void {
      const len: number = this.writeManualErrorJson(msg);
      this.writeBuffer(STDERR_FD, this.util, 0, len);

      const body: c_ptr = ptr_add(this.frame, HEADER_SIZE);
      copy_bytes(body, 0, this.util, 0, len);
      this.sendChunk(len);

      c_exit(1);
    }

    mainProcessingLoop(): number {
      const header: c_ptr = this.header;
      let status: number = 0;
      while (true) {
        let bytesRead: number = 0;
        let filled: number = 0;
        while (filled < HEADER_SIZE) {
          const n: number = this.io.read(
            STDIN_FD,
            header,
            filled,
            HEADER_SIZE - filled,
          );
          if (n <= 0) {
            bytesRead = filled;
            break;
          }
          filled = filled + n;
          bytesRead = filled;
        }

        if (bytesRead === 0) {
          status = 0;
          break;
        }
        if (bytesRead < HEADER_SIZE) {
          status = 1;
          break;
        }

        const totalIncomingBytes: number = this.readLengthFromHeader();
        this.streamIncomingMessage(totalIncomingBytes);
      }
      return status;
    }
  }

  function run(): void {
    const pipeline: NativeHostPipeline = new NativeHostPipeline();
    const initMessage: string = "Static Hermes Native Messaging streaming host";

    const initLen: number = pipeline.writeStringToUtilBuffer(initMessage);
    pipeline.writeBuffer(STDERR_FD, pipeline.util, 0, initLen);

    const statusCode: number = pipeline.mainProcessingLoop();
    if (statusCode === 1) {
      pipeline.handleCrash("stdin closed mid-header");
    }
  }

  run();
})({});
